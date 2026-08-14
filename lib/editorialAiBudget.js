function numberSetting(name, fallback = 0) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function startOfDay() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function startOfMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function estimateTokens(context, scope) {
  const input_tokens = Math.ceil(JSON.stringify(context || {}).length / 4);
  const output_tokens = scope === 'headline' ? 900 : scope === 'body' ? 3000 : 4200;
  return { input_tokens, output_tokens };
}

function sumCost(events) {
  return (events || []).reduce((sum, event) => sum + Number(event.estimated_cost_usd || 0), 0);
}

async function loadModelPrice(supabase, route) {
  const { data, error } = await supabase.from('model_prices')
    .select('input_per_million_usd, output_per_million_usd, fixed_cost_usd')
    .eq('provider', route.provider).eq('model', route.model).eq('active', true).maybeSingle();
  if (error) {
    const wrapped = new Error('AI 비용 설정 마이그레이션 적용이 필요합니다.');
    wrapped.statusCode = 409;
    throw wrapped;
  }
  return data || null;
}

async function reserveAiBudget(supabase, { draftId, route, context, scope }) {
  const limits = {
    daily: numberSetting('AI_DAILY_BUDGET_USD'),
    monthly: numberSetting('AI_MONTHLY_BUDGET_USD'),
    draft: numberSetting('AI_PER_DRAFT_BUDGET_USD'),
  };
  const hasLimit = Object.values(limits).some(Boolean);
  const tokens = estimateTokens(context, scope);
  if (!hasLimit) return { ...tokens, estimated_cost_usd: 0, price_configured: false };
  const price = await loadModelPrice(supabase, route);
  if (hasLimit && !price) {
    const error = new Error(`${route.provider}/${route.model}의 단가를 model_prices에 등록한 뒤 예산 한도를 사용할 수 있습니다.`);
    error.statusCode = 409;
    throw error;
  }
  const estimated_cost_usd = price
    ? Number(((tokens.input_tokens / 1000000) * Number(price.input_per_million_usd || 0) + (tokens.output_tokens / 1000000) * Number(price.output_per_million_usd || 0) + Number(price.fixed_cost_usd || 0)).toFixed(6))
    : 0;
  const [daily, monthly, draft] = await Promise.all([
    supabase.from('ai_usage_events').select('estimated_cost_usd').gte('created_at', startOfDay()),
    supabase.from('ai_usage_events').select('estimated_cost_usd').gte('created_at', startOfMonth()),
    supabase.from('ai_usage_events').select('estimated_cost_usd').eq('draft_id', draftId),
  ]);
  for (const result of [daily, monthly, draft]) {
    if (result.error) {
      const error = new Error('AI 사용량 마이그레이션 적용이 필요합니다.');
      error.statusCode = 409;
      throw error;
    }
  }
  const spent = { daily: sumCost(daily.data), monthly: sumCost(monthly.data), draft: sumCost(draft.data) };
  for (const key of Object.keys(limits)) {
    if (limits[key] > 0 && spent[key] + estimated_cost_usd > limits[key]) {
      const error = new Error(`AI ${key === 'draft' ? '초안별' : key === 'daily' ? '일일' : '월간'} 예산 한도에 도달했습니다.`);
      error.statusCode = 429;
      throw error;
    }
  }
  return { ...tokens, estimated_cost_usd, price_configured: true };
}

async function recordAiUsage(supabase, { draftId, route, scope, reserved, usage, status, errorMessage }) {
  const inputTokens = Number(usage?.input_tokens || reserved?.input_tokens || 0);
  const outputTokens = Number(usage?.output_tokens || reserved?.output_tokens || 0);
  const record = {
    draft_id: draftId,
    provider: route.provider,
    model: route.model,
    tier: route.tier,
    request_type: scope || 'full',
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_tokens: Number(usage?.cached_tokens || 0),
    estimated_cost_usd: Number(reserved?.estimated_cost_usd || 0),
    status: status || 'succeeded',
    error_message: errorMessage ? String(errorMessage).slice(0, 1000) : null,
  };
  const { error } = await supabase.from('ai_usage_events').insert(record);
  if (error) console.warn('[editorial-ai] usage was not recorded:', error.message);
  return { ...record, recorded: !error };
}

module.exports = { estimateTokens, recordAiUsage, reserveAiBudget };
