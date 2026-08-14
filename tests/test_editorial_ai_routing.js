const assert = require('node:assert/strict');
const fs = require('node:fs');
const { estimateTokens } = require('../lib/editorialAiBudget');
const { resolveEditorialAiRoute, resolveRealtimeAiRoute } = require('../lib/editorialAiProvider');

const keys = [
  'AI_ENABLED', 'AI_BASIC_PROVIDER', 'AI_BASIC_MODEL', 'AI_ADVANCED_PROVIDER',
  'AI_ADVANCED_OPENAI_MODEL', 'AI_ADVANCED_ANTHROPIC_MODEL', 'ANTHROPIC_API_KEY',
  'AI_REALTIME_ENABLED', 'AI_REALTIME_PROVIDER', 'AI_REALTIME_MODEL', 'XAI_API_KEY',
];
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
try {
  process.env.AI_ENABLED = 'true';
  delete process.env.AI_BASIC_MODEL;
  delete process.env.AI_ADVANCED_OPENAI_MODEL;
  process.env.AI_BASIC_PROVIDER = 'openai';
  process.env.AI_ADVANCED_PROVIDER = 'openai';
  assert.deepEqual(resolveEditorialAiRoute({}), { provider: 'openai', model: 'gpt-5-mini', tier: 'basic' });
  assert.deepEqual(resolveEditorialAiRoute({ tier: 'advanced' }), { provider: 'openai', model: 'gpt-5.4-mini', tier: 'advanced' });

  process.env.AI_ADVANCED_PROVIDER = 'anthropic';
  process.env.ANTHROPIC_API_KEY = 'test-key';
  assert.deepEqual(resolveEditorialAiRoute({ tier: 'advanced' }), { provider: 'anthropic', model: 'claude-sonnet-5', tier: 'advanced' });
  assert.throws(() => resolveEditorialAiRoute({ tier: 'advanced', requestedModel: 'other' }), /서버 환경변수/);

  process.env.AI_ENABLED = 'false';
  assert.throws(() => resolveEditorialAiRoute({}), /비활성화/);
  process.env.AI_ENABLED = 'true';
  process.env.AI_REALTIME_ENABLED = 'false';
  assert.throws(() => resolveRealtimeAiRoute(), /비활성화/);
  process.env.AI_REALTIME_ENABLED = 'true';
  process.env.AI_REALTIME_PROVIDER = 'xai';
  process.env.XAI_API_KEY = 'test-key';
  assert.deepEqual(resolveRealtimeAiRoute(), { provider: 'xai', model: 'grok-4.5', tier: 'advanced' });

  const estimate = estimateTokens({ evidence: [{ summary: 'x'.repeat(100) }] }, 'headline');
  assert.equal(estimate.output_tokens, 900);
  assert.ok(estimate.input_tokens > 0);

  const migration = fs.readFileSync(require.resolve('../supabase/migrations/20260814_editorial_ai_routing_budget.sql'), 'utf8');
  assert.match(migration, /create table if not exists model_prices/);
  assert.match(migration, /create table if not exists ai_usage_events/);
} finally {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

process.stdout.write('Editorial AI routing and budget checks passed.\n');
