const ALLOWED_SCOPES = new Set(['full', 'headline', 'body', 'polish']);

const ARTICLE_RESPONSE_SCHEMA = {
  name: 'editorial_article', strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['title', 'subtitles', 'summary', 'body_html', 'tags', 'category_recommendation', 'source_url', 'image_prompt', 'thumbnail_alt', 'thumbnail_caption', 'fact_checks', 'warnings'],
    properties: {
      title: { type: 'string' },
      subtitles: { type: 'array', items: { type: 'string' }, maxItems: 3 },
      summary: { type: 'string' }, body_html: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 12 },
      category_recommendation: { type: 'string' }, source_url: { type: 'string' }, image_prompt: { type: 'string' },
      thumbnail_alt: { type: 'string' }, thumbnail_caption: { type: 'string' },
      fact_checks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['claim', 'source_url', 'status'], properties: { claim: { type: 'string' }, source_url: { type: 'string' }, status: { type: 'string', enum: ['supported', 'needs_review'] } } } },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  },
};

function cleanText(value, limit) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit); }
function sanitizeArticleHtml(value) {
  return String(value || '')
    .replace(/<(script|style|iframe|object|embed|form|meta|link)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|form|meta|link)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*(["']).*?\1/gi, '')
    .replace(/javascript:/gi, '').trim().slice(0, 30000);
}
function normalizeUrls(values) { return [...new Set((values || []).map((value) => String(value || '').trim()).filter((value) => /^https?:\/\//i.test(value)))]; }

function buildEvidence(cluster, articles, facts) {
  const evidence = [
    ...(articles || []).map((article) => ({ title: cleanText(article.title, 300), summary: cleanText(article.summary, 1200), url: article.url, publisher: article.source_domain || article.source || '', source_type: article.source_type || '', published_at: article.published_at || '', verified: article.verification_status === 'verified' })),
    ...(facts || []).map((fact) => ({ fact: cleanText(fact.fact_text, 600), fact_type: fact.fact_type || '', url: fact.source_url, official: Boolean(fact.is_official), confidence: Number(fact.confidence || 0) })),
  ].filter((item) => item.url);
  return { event: { title: cleanText(cluster?.representative_title, 500), category: cleanText(cluster?.category, 80), event_date: cluster?.event_date || '' }, evidence: evidence.slice(0, 18), urls: normalizeUrls(evidence.map((item) => item.url)) };
}

function buildArticleMessages(context, options = {}) {
  const scope = ALLOWED_SCOPES.has(options.scope) ? options.scope : 'full';
  return [
    { role: 'system', content: ['You prepare a Korean news article draft for editorial review.', 'Use only the supplied evidence. Do not invent dates, figures, organisations, quotes, outcomes, or URLs.', 'When evidence is insufficient, leave the claim out and put the reason in warnings.', 'Write neutral Korean reporting prose. HTML may use only p, h3, ul, ol, li, strong, em, and a tags.', 'The image prompt must describe an editorial illustration, not a real event photo; it must exclude text, logos, and identifiable real people.', `Requested scope: ${scope}. Current draft content may be improved only for that scope; still return every JSON field.`].join(' ') },
    { role: 'user', content: JSON.stringify({ tone: cleanText(options.tone || 'neutral', 80), length: cleanText(options.length || 'standard', 80), editor_instruction: cleanText(options.instructions, 1200) || null, current_draft: options.currentDraft || {}, ...context }) },
  ];
}

function normalizeArticlePayload(payload, evidenceUrls) {
  const urls = normalizeUrls(evidenceUrls); const firstUrl = urls[0] || '';
  return {
    title: cleanText(payload?.title, 500), subtitles: (Array.isArray(payload?.subtitles) ? payload.subtitles : []).map((item) => cleanText(item, 300)).filter(Boolean).slice(0, 3), summary: cleanText(payload?.summary, 1800), body_html: sanitizeArticleHtml(payload?.body_html),
    tags: [...new Set((Array.isArray(payload?.tags) ? payload.tags : []).map((item) => cleanText(item, 40)).filter(Boolean))].slice(0, 12), category_recommendation: cleanText(payload?.category_recommendation, 80), source_url: urls.includes(payload?.source_url) ? payload.source_url : firstUrl, image_prompt: cleanText(payload?.image_prompt, 1800), thumbnail_alt: cleanText(payload?.thumbnail_alt, 300), thumbnail_caption: cleanText(payload?.thumbnail_caption, 300),
    fact_checks: (Array.isArray(payload?.fact_checks) ? payload.fact_checks : []).filter((item) => urls.includes(item?.source_url)).map((item) => ({ claim: cleanText(item.claim, 500), source_url: item.source_url, status: item.status === 'supported' ? 'supported' : 'needs_review' })).filter((item) => item.claim).slice(0, 8),
    warnings: (Array.isArray(payload?.warnings) ? payload.warnings : []).map((item) => cleanText(item, 400)).filter(Boolean).slice(0, 8),
  };
}

async function generateEditorialArticle(openai, model, context, options) {
  const response = await openai.chat.completions.create({ model, messages: buildArticleMessages(context, options), response_format: { type: 'json_schema', json_schema: ARTICLE_RESPONSE_SCHEMA } });
  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI returned an empty article proposal.');
  let parsed; try { parsed = JSON.parse(content); } catch { throw new Error('AI returned an invalid article proposal.'); }
  return normalizeArticlePayload(parsed, context.urls);
}

function reviewDraftEvidence(draft, evidenceUrls) {
  const knownUrls = normalizeUrls(evidenceUrls); const linkedUrls = normalizeUrls(String(draft?.body_html || '').match(/https?:\/\/[^\s"'<>]+/g) || []); const unknownUrls = linkedUrls.filter((url) => !knownUrls.includes(url));
  const textLength = String(draft?.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
  const checks = [
    { label: '제목', status: cleanText(draft?.title, 500) ? 'pass' : 'block', detail: cleanText(draft?.title, 500) ? '대표 제목이 있습니다.' : '대표 제목을 입력하세요.' },
    { label: '본문', status: textLength >= 200 ? 'pass' : 'warning', detail: textLength >= 200 ? `본문 ${textLength}자` : `본문이 ${textLength}자입니다. 200자 이상이 필요합니다.` },
    { label: '근거 URL', status: linkedUrls.length ? 'pass' : 'warning', detail: linkedUrls.length ? `본문에서 ${linkedUrls.length}개 URL을 확인했습니다.` : '본문에 근거 URL이 없습니다.' },
    { label: '근거 범위', status: unknownUrls.length ? 'block' : 'pass', detail: unknownUrls.length ? `수집 근거에 없는 URL ${unknownUrls.length}개가 있습니다.` : '본문 링크가 수집 근거 범위 안에 있습니다.' },
  ];
  return { ready: !checks.some((item) => item.status === 'block'), checks, known_url_count: knownUrls.length };
}

const BRIEF_SUMMARY_REVIEW_SCHEMA = {
  name: 'brief_summary_review',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'reason', 'issues', 'supported_points', 'missing_points'],
    properties: {
      verdict: { type: 'string', enum: ['supported', 'needs_review', 'insufficient'] },
      reason: { type: 'string' },
      issues: { type: 'array', items: { type: 'string' } },
      supported_points: { type: 'array', items: { type: 'string' } },
      missing_points: { type: 'array', items: { type: 'string' } },
    },
  },
};

function buildBriefReviewMessages({ digest, context } = {}) {
  return [
    {
      role: 'system',
      content: [
        'You verify a Korean research-brief summary against supplied evidence only.',
        'Do not invent dates, figures, organisations, quotes, or outcomes.',
        'supported: the summary is consistent with the evidence and does not add new claims.',
        'needs_review: the summary has unsupported, overstated, or conflicting claims.',
        'insufficient: the evidence is too thin to confirm the summary.',
        'Write reason, issues, supported_points, and missing_points in Korean.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        summary: cleanText(digest?.summary, 1600),
        title: cleanText(digest?.title, 500),
        highlights: digest?.highlights || [],
        event: context?.event || {},
        evidence: (context?.evidence || []).slice(0, 12),
      }),
    },
  ];
}

function normalizeBriefReview(payload) {
  const verdict = ['supported', 'needs_review', 'insufficient'].includes(payload?.verdict)
    ? payload.verdict
    : 'needs_review';
  const cleanList = (values) => (Array.isArray(values) ? values : [])
    .map((item) => cleanText(item, 300))
    .filter(Boolean)
    .slice(0, 6);
  return {
    verdict,
    reason: cleanText(payload?.reason, 500) || '검증 결과를 확인하세요.',
    issues: cleanList(payload?.issues),
    supported_points: cleanList(payload?.supported_points),
    missing_points: cleanList(payload?.missing_points),
  };
}

function buildImagePrompt(draft, requestedPrompt) {
  const prompt = cleanText(requestedPrompt, 1800) || [cleanText(draft?.title, 500), cleanText(draft?.summary, 800)].filter(Boolean).join('. ');
  if (!prompt) throw new Error('이미지 생성을 위한 제목 또는 프롬프트가 필요합니다.');
  return `${prompt}. Editorial illustration for a Korean news article, horizontal 3:2 composition, no text, no logos, no watermark, no identifiable real people.`;
}

module.exports = {
  ARTICLE_RESPONSE_SCHEMA,
  BRIEF_SUMMARY_REVIEW_SCHEMA,
  buildArticleMessages,
  buildBriefReviewMessages,
  buildEvidence,
  buildImagePrompt,
  generateEditorialArticle,
  normalizeArticlePayload,
  normalizeBriefReview,
  reviewDraftEvidence,
  sanitizeArticleHtml,
};
