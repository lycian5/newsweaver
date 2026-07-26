const { getSupabase } = require('../../lib/supabase');
const {
  assertCronAuth,
  clearDashboardSessionCookie,
  createDashboardSessionCookie,
  verifyDashboardPassword,
  verifyDashboardSession,
} = require('../../lib/cronAuth');
const { selectHybridKeywords } = require('../../scripts/keyword-selection');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'POST' && req.body?.action === 'login') return login(req, res);
  if (req.method === 'POST' && req.body?.action === 'logout') return logout(req, res);
  if (req.method === 'GET' && req.query?.view === 'session') {
    return res.status(200).json({ authenticated: verifyDashboardSession(req) });
  }
  try { assertCronAuth(req); } catch (err) { res.status(err.statusCode || 401).json({ error: err.message }); return; }
  try {
    if (req.method === 'GET' && req.query?.view === 'briefs') return listBriefs(req, res);
    if (req.method === 'GET' && req.query?.view === 'keywords') return listKeywords(req, res);
    if (req.method === 'GET') return listDrafts(req, res);
    if (req.method === 'POST' && req.body?.action === 'prepare') return prepareArticleDraft(req, res);
    if (req.method === 'PATCH') return updateDraft(req, res);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[editorial/drafts]', err.message);
    res.status(500).json({ error: err.message });
  }
};

async function login(req, res) {
  if (!process.env.DASHBOARD_PASSWORD) {
    return res.status(503).json({ error: 'DASHBOARD_PASSWORD is not configured' });
  }
  if (!verifyDashboardPassword(req.body?.password)) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return res.status(401).json({ error: '로그인 정보가 올바르지 않습니다.' });
  }
  res.setHeader('Set-Cookie', createDashboardSessionCookie());
  return res.status(200).json({ ok: true, expiresIn: 604800 });
}

function logout(req, res) {
  res.setHeader('Set-Cookie', clearDashboardSessionCookie());
  return res.status(200).json({ ok: true });
}

async function listKeywords(req, res) {
  const supabase = getSupabase();
  const limitKeywords = clamp(
    req.query?.limitKeywords,
    1,
    100,
    Number(process.env.AGENT_REACH_LIMIT_KEYWORDS || 54)
  );
  const coreKeywordCount = Number(process.env.AGENT_REACH_CORE_KEYWORDS || 12);
  const rotatingKeywordCount = Number(process.env.AGENT_REACH_ROTATING_KEYWORDS || 42);
  const { data: keywords, error } = await supabase
    .from('tracked_keywords')
    .select('id, keyword, category, datalab_priority')
    .eq('status', 'active')
    .order('datalab_priority', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;

  const selected = selectHybridKeywords(keywords || [], {
    limitKeywords,
    coreKeywordCount,
    rotatingKeywordCount,
    date: new Date(),
  });
  const coreCount = Math.min(coreKeywordCount, selected.length);
  const koreaDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  res.status(200).json({
    date: koreaDate,
    core: selected.slice(0, coreCount),
    rotating: selected.slice(coreCount),
  });
}

async function listBriefs(req, res) {
  const supabase = getSupabase();
  const limit = clamp(req.query?.limit, 1, 100, 100);
  let query = supabase
    .from('event_clusters')
    .select('id,category,representative_title,event_date,first_seen_at,last_seen_at,article_count,official_source_count,status')
    .order('last_seen_at', { ascending: false })
    .limit(limit);
  if (req.query?.category) query = query.eq('category', req.query.category);
  if (req.query?.status) query = query.eq('status', req.query.status);
  const { data: clusters, error } = await query;
  if (error) throw error;
  const ids = (clusters || []).map((item) => item.id);
  if (!ids.length) return res.status(200).json({ briefs: [] });
  const [{ data: articles, error: articleError }, { data: facts, error: factError }] = await Promise.all([
    supabase.from('raw_articles').select('id,event_cluster_id,title,url,summary,published_at,source_domain,source_type,quality_score,verification_status').in('event_cluster_id', ids).order('quality_score', { ascending: false }),
    supabase.from('article_facts').select('id,event_cluster_id,raw_article_id,fact_text,fact_type,source_url,is_official,confidence,verified_at').in('event_cluster_id', ids).order('confidence', { ascending: false }),
  ]);
  if (articleError) throw articleError;
  if (factError) throw factError;
  res.status(200).json({ briefs: clusters.map((cluster) => ({
    ...cluster,
    articles: (articles || []).filter((item) => item.event_cluster_id === cluster.id),
    facts: (facts || []).filter((item) => item.event_cluster_id === cluster.id),
  })) });
}

async function listDrafts(req, res) {
  const supabase = getSupabase();
  let query = supabase.from('editorial_drafts').select('*').order('updated_at', { ascending: false }).limit(100);
  if (req.query?.id) query = query.eq('id', req.query.id);
  if (req.query?.status) query = query.eq('status', req.query.status);
  const { data, error } = await query;
  if (error) throw error;
  res.status(200).json({ drafts: data || [] });
}

async function prepareArticleDraft(req, res) {
  const clusterId = Number.parseInt(req.body?.eventClusterId, 10);
  if (!clusterId) return res.status(400).json({ error: 'eventClusterId is required' });
  const supabase = getSupabase();
  const [{ data: cluster, error: clusterError }, { data: articles, error: articleError }, { data: facts, error: factError }] = await Promise.all([
    supabase.from('event_clusters').select('*').eq('id', clusterId).single(),
    supabase.from('raw_articles').select('title,url,summary,source_domain,source_type,quality_score,verification_status').eq('event_cluster_id', clusterId).order('quality_score', { ascending: false }),
    supabase.from('article_facts').select('fact_text,fact_type,source_url,is_official,confidence').eq('event_cluster_id', clusterId).order('confidence', { ascending: false }),
  ]);
  if (clusterError) throw clusterError;
  if (articleError) throw articleError;
  if (factError) throw factError;
  const validation = validateBriefForPreparation(cluster, articles, facts);
  if (!validation.ready) return res.status(409).json({ error: validation.blockers[0], validation });

  const starter = buildArticleStarter(cluster, articles, facts);
  const row = {
    event_cluster_id: clusterId,
    title: starter.title,
    subtitle: null,
    summary: starter.summary,
    body_html: starter.bodyHtml,
    tags: starter.tags,
    status: 'draft',
    model: null,
  };
  const { data, error } = await supabase.from('editorial_drafts').insert(row).select().single();
  if (error) throw error;
  res.status(201).json({
    draft: data,
    validation,
    seed: {
      title: starter.title,
      summary: starter.summary,
      source_name: starter.primarySource.source_domain || 'COA NEWS 리서치',
      source_url: starter.primarySource.url || '',
      category: cluster.category,
      event_cluster_id: clusterId,
      draft_id: data.id,
      references: articles.map((article) => article.url).filter(Boolean),
      facts: facts.map((fact) => ({
        text: fact.fact_text,
        source_url: fact.source_url,
        is_official: fact.is_official,
        confidence: fact.confidence,
      })),
      validation,
    },
  });
}

async function updateDraft(req, res) {
  const id = Number.parseInt(req.body?.id, 10);
  if (!id) return res.status(400).json({ error: 'id is required' });
  const supabase = getSupabase();
  const { data: current, error: readError } = await supabase.from('editorial_drafts').select('*').eq('id', id).single();
  if (readError) throw readError;
  const action = req.body?.action || 'save';
  const now = new Date().toISOString();
  const updates = { updated_at: now };
  if (action === 'save') {
    if (!['draft', 'rejected'].includes(current.status)) return res.status(409).json({ error: '승인대기 또는 승인 완료 초안은 수정할 수 없습니다.' });
    for (const [input, column] of [['title','title'],['subtitle','subtitle'],['summary','summary'],['bodyHtml','body_html'],['editorialNotes','editorial_notes']]) {
      if (typeof req.body?.[input] === 'string') updates[column] = req.body[input];
    }
    if (Array.isArray(req.body?.tags)) updates.tags = req.body.tags.slice(0, 20);
    updates.status = 'draft';
  } else if (action === 'submit' && ['draft', 'rejected'].includes(current.status)) {
    const problems = validateArticleDraft(current);
    if (problems.length) return res.status(400).json({ error: problems[0], problems });
    updates.status = 'pending_editor_approval'; updates.submitted_at = now; updates.decided_at = null;
  } else if (action === 'approve' && current.status === 'pending_editor_approval') {
    updates.status = 'approved'; updates.decided_at = now;
  } else if (action === 'reject' && current.status === 'pending_editor_approval') {
    const note = String(req.body?.editorialNotes || '').trim();
    if (!note) return res.status(400).json({ error: '반려 사유를 편집 메모에 입력하세요.' });
    updates.status = 'rejected'; updates.decided_at = now; updates.editorial_notes = note.slice(0, 3000);
  } else {
    return res.status(409).json({ error: `허용되지 않은 상태 전환입니다: ${current.status} -> ${action}` });
  }
  const { data, error } = await supabase.from('editorial_drafts').update(updates).eq('id', id).select().single();
  if (error) throw error;
  res.status(200).json({ draft: data });
}

function validateBriefForPreparation(cluster, articles, facts) {
  const blockers = [];
  const warnings = [];
  if (!cluster?.representative_title?.trim()) blockers.push('대표 제목이 없어 기사 초안을 준비할 수 없습니다.');
  if (!articles?.length) blockers.push('근거 기사가 없어 기사 초안을 준비할 수 없습니다.');
  if (articles?.length && !articles.some((article) => article.url)) blockers.push('사용 가능한 근거 기사 URL이 없습니다.');
  const hasVerifiedSource = articles?.some((article) => article.verification_status === 'verified');
  const hasOfficialSource = Number(cluster?.official_source_count || 0) > 0;
  if (!hasVerifiedSource && !hasOfficialSource) blockers.push('공식 또는 검증된 출처가 한 건 이상 필요합니다.');
  if (cluster?.status !== 'ready') warnings.push('리서치 브리프 상태가 작성 가능(ready)이 아닙니다.');
  if (!facts?.length) warnings.push('구조화된 확인 사실이 없습니다. 원문에서 날짜·기관·수치를 다시 확인하세요.');
  if (!hasOfficialSource) warnings.push('공식 출처가 없습니다. 인용 범위와 사실관계를 추가 검토하세요.');
  return {
    ready: blockers.length === 0,
    checked_at: new Date().toISOString(),
    blockers,
    warnings,
    checks: {
      title: Boolean(cluster?.representative_title?.trim()),
      evidence: Boolean(articles?.length),
      source_url: Boolean(articles?.some((article) => article.url)),
      verified_source: Boolean(hasVerifiedSource || hasOfficialSource),
      structured_facts: Boolean(facts?.length),
    },
  };
}

function buildArticleStarter(cluster, articles, facts) {
  const primarySource = articles[0] || {};
  const factItems = facts.length
    ? facts.map((fact) => `<li>${escapeHtml(fact.fact_text)}</li>`).join('')
    : '<li>구조화 사실 없음 — 근거 기사 원문에서 핵심 사실을 확인하세요.</li>';
  const referenceItems = articles
    .filter((article) => article.url)
    .map((article) => `<li><a href="${escapeHtml(article.url)}">${escapeHtml(article.title || article.url)}</a></li>`)
    .join('');
  const summaryParts = [
    ...facts.map((fact) => fact.fact_text),
    primarySource.summary,
  ].filter(Boolean);
  return {
    title: String(cluster.representative_title || '').slice(0, 500),
    summary: summaryParts.join('\n').slice(0, 1500),
    bodyHtml: [
      '<h3>확인된 사실</h3>',
      `<ul>${factItems}</ul>`,
      '<h3>기사 작성 메모</h3>',
      `<p>${escapeHtml(primarySource.summary || '근거 기사 내용을 토대로 완성된 기사 본문을 작성하세요.')}</p>`,
      '<h3>참고자료</h3>',
      `<ul>${referenceItems}</ul>`,
    ].join('\n'),
    tags: categoryTags(cluster.category),
    primarySource,
  };
}

function validateArticleDraft(draft) {
  const problems = [];
  if (!draft?.title?.trim()) problems.push('기사 제목을 입력하세요.');
  if (htmlTextLength(draft?.body_html) < 200) problems.push('기사 본문을 200자 이상 작성하세요.');
  return problems;
}

function htmlTextLength(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
}

function categoryTags(category) {
  return {
    ai_business: ['AI', 'AI비즈니스'],
    startup: ['창업', '부업'],
    policy: ['소상공인', '정책지원'],
  }[category] || [];
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));
}

function clamp(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

module.exports.validateBriefForPreparation = validateBriefForPreparation;
module.exports.buildArticleStarter = buildArticleStarter;
module.exports.validateArticleDraft = validateArticleDraft;
