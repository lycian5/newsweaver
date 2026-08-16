const { getOpenAI } = require('./openai');
const { resolveOpenAIModel } = require('./openaiModels');
const {
  ARTICLE_RESPONSE_SCHEMA,
  BRIEF_SUMMARY_REVIEW_SCHEMA,
  buildArticleMessages,
  buildBriefReviewMessages,
  normalizeArticlePayload,
  normalizeBriefReview,
} = require('./editorialAi');

const PROVIDERS = new Set(['openai', 'anthropic', 'xai']);
const TIERS = new Set(['basic', 'advanced']);

function aiError(message, statusCode = 503) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function aiEnabled() {
  return String(process.env.AI_ENABLED || '').toLowerCase() !== 'false';
}

function resolveEditorialAiRoute({ tier, requestedModel } = {}) {
  if (!aiEnabled()) throw aiError('AI 작성 기능이 비활성화되어 있습니다. AI_ENABLED를 true로 설정하세요.');
  const selectedTier = TIERS.has(tier) ? tier : 'basic';
  const provider = String(
    selectedTier === 'advanced'
      ? process.env.AI_ADVANCED_PROVIDER || 'openai'
      : process.env.AI_BASIC_PROVIDER || 'openai'
  ).toLowerCase();
  if (!PROVIDERS.has(provider)) throw aiError(`지원하지 않는 AI 제공자입니다: ${provider}`, 400);

  let model;
  if (provider === 'openai') {
    const configuredModel = selectedTier === 'advanced'
      ? process.env.AI_ADVANCED_OPENAI_MODEL
      : process.env.AI_BASIC_MODEL;
    model = resolveOpenAIModel(selectedTier === 'advanced' ? 'premium' : 'draft', requestedModel || configuredModel);
  } else if (provider === 'anthropic') {
    if (requestedModel) throw aiError('Anthropic 모델은 서버 환경변수로만 선택할 수 있습니다.', 400);
    model = process.env.AI_ADVANCED_ANTHROPIC_MODEL || 'claude-sonnet-5';
    if (!process.env.ANTHROPIC_API_KEY) throw aiError('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
  } else {
    throw aiError('xAI/Grok은 실시간 보강 전용입니다. 기사 초안 고급 분석에는 openai 또는 anthropic을 선택하세요.', 400);
  }

  return { provider, model, tier: selectedTier };
}

function resolveRealtimeAiRoute() {
  if (String(process.env.AI_REALTIME_ENABLED || '').toLowerCase() !== 'true') {
    throw aiError('실시간 AI 보강은 비활성화되어 있습니다. AI_REALTIME_ENABLED=true로 명시적으로 켜세요.', 403);
  }
  if ((process.env.AI_REALTIME_PROVIDER || 'xai').toLowerCase() !== 'xai' || !process.env.XAI_API_KEY) {
    throw aiError('xAI 실시간 보강 설정이 완료되지 않았습니다.');
  }
  return { provider: 'xai', model: process.env.AI_REALTIME_MODEL || 'grok-4.5', tier: 'advanced' };
}

async function generateEditorialProposal(route, context, options) {
  const messages = buildArticleMessages(context, options);
  if (route.provider === 'openai') return generateWithOpenAI(route, messages, context.urls);
  if (route.provider === 'anthropic') return generateWithAnthropic(route, messages, context.urls);
  return generateWithXai(route, messages, context.urls);
}

async function generateBriefSummaryReview(route, payload) {
  const messages = buildBriefReviewMessages(payload);
  if (route.provider === 'openai') {
    const response = await getOpenAI().chat.completions.create({
      model: route.model,
      messages,
      response_format: { type: 'json_schema', json_schema: BRIEF_SUMMARY_REVIEW_SCHEMA },
    });
    const content = response.choices?.[0]?.message?.content;
    return {
      review: parseBriefReview(content),
      usage: {
        input_tokens: Number(response.usage?.prompt_tokens || 0),
        output_tokens: Number(response.usage?.completion_tokens || 0),
        cached_tokens: Number(response.usage?.prompt_tokens_details?.cached_tokens || 0),
      },
    };
  }
  if (route.provider === 'anthropic') {
    const system = messages.find((message) => message.role === 'system')?.content || '';
    const user = messages.find((message) => message.role === 'user')?.content || '';
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: route.model,
        max_tokens: 1200,
        system: `${system}\nReturn only valid JSON matching this schema: ${JSON.stringify(BRIEF_SUMMARY_REVIEW_SCHEMA.schema)}`,
        messages: [{ role: 'user', content: user }],
      }),
    });
    const payloadJson = await response.json();
    if (!response.ok) throw aiError(payloadJson.error?.message || `Anthropic 요청 실패 (HTTP ${response.status})`, response.status);
    return {
      review: parseBriefReview(payloadJson.content?.find((item) => item.type === 'text')?.text),
      usage: {
        input_tokens: Number(payloadJson.usage?.input_tokens || 0),
        output_tokens: Number(payloadJson.usage?.output_tokens || 0),
        cached_tokens: Number(payloadJson.usage?.cache_read_input_tokens || 0),
      },
    };
  }
  throw aiError('브리프 요약 검증은 openai 또는 anthropic만 지원합니다.', 400);
}

function parseBriefReview(content) {
  if (!content) throw aiError('AI가 비어 있는 요약 검증 결과를 반환했습니다.', 502);
  try {
    return normalizeBriefReview(JSON.parse(content));
  } catch (err) {
    if (err.statusCode) throw err;
    throw aiError('AI가 유효한 JSON 요약 검증 결과를 반환하지 않았습니다.', 502);
  }
}

async function generateWithOpenAI(route, messages, evidenceUrls) {
  const response = await getOpenAI().chat.completions.create({
    model: route.model,
    messages,
    response_format: { type: 'json_schema', json_schema: ARTICLE_RESPONSE_SCHEMA },
  });
  const content = response.choices?.[0]?.message?.content;
  return {
    proposal: parseProposal(content, evidenceUrls),
    usage: {
      input_tokens: Number(response.usage?.prompt_tokens || 0),
      output_tokens: Number(response.usage?.completion_tokens || 0),
      cached_tokens: Number(response.usage?.prompt_tokens_details?.cached_tokens || 0),
    },
  };
}

async function generateWithAnthropic(route, messages, evidenceUrls) {
  const system = messages.find((message) => message.role === 'system')?.content || '';
  const user = messages.find((message) => message.role === 'user')?.content || '';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: route.model,
      max_tokens: 4000,
      system: `${system}\nReturn only valid JSON matching this schema: ${JSON.stringify(ARTICLE_RESPONSE_SCHEMA.schema)}`,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw aiError(payload.error?.message || `Anthropic 요청 실패 (HTTP ${response.status})`, response.status);
  return {
    proposal: parseProposal(payload.content?.find((item) => item.type === 'text')?.text, evidenceUrls),
    usage: { input_tokens: Number(payload.usage?.input_tokens || 0), output_tokens: Number(payload.usage?.output_tokens || 0), cached_tokens: Number(payload.usage?.cache_read_input_tokens || 0) },
  };
}

async function generateWithXai(route, messages, evidenceUrls) {
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.XAI_API_KEY}` },
    body: JSON.stringify({
      model: route.model,
      messages,
      response_format: { type: 'json_schema', json_schema: ARTICLE_RESPONSE_SCHEMA },
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw aiError(payload.error?.message || `xAI 요청 실패 (HTTP ${response.status})`, response.status);
  return {
    proposal: parseProposal(payload.choices?.[0]?.message?.content, evidenceUrls),
    usage: { input_tokens: Number(payload.usage?.prompt_tokens || 0), output_tokens: Number(payload.usage?.completion_tokens || 0), cached_tokens: Number(payload.usage?.prompt_tokens_details?.cached_tokens || 0) },
  };
}

function parseProposal(content, evidenceUrls) {
  if (!content) throw aiError('AI가 비어 있는 기사 제안을 반환했습니다.', 502);
  try {
    return normalizeArticlePayload(JSON.parse(content), evidenceUrls);
  } catch {
    throw aiError('AI가 유효한 JSON 기사 제안을 반환하지 않았습니다.', 502);
  }
}

module.exports = {
  PROVIDERS,
  TIERS,
  aiEnabled,
  generateBriefSummaryReview,
  generateEditorialProposal,
  resolveEditorialAiRoute,
  resolveRealtimeAiRoute,
};
