const assert = require('node:assert/strict');
const fs = require('node:fs');
const { selectRisingKeywords } = require('../scripts/rising-keywords');
const { selectCollectionKeywords } = require('../scripts/keyword-selection');

const now = new Date('2026-08-01T12:00:00.000Z');
const rows = [
  { keyword_id: 1, keyword: 'AI 에이전트', category: 'ai_business', collected_at: '2026-08-01T10:00:00.000Z' },
  { keyword_id: 1, keyword: 'AI 에이전트', category: 'ai_business', collected_at: '2026-08-01T09:00:00.000Z' },
  { keyword_id: 2, keyword: 'AI 보안', category: 'ai_business', collected_at: '2026-07-27T10:00:00.000Z' },
  { keyword_id: 3, keyword: '창업 지원', category: 'startup', collected_at: '2026-08-01T10:00:00.000Z' },
  { keyword_id: 4, keyword: '정책자금', category: 'policy', collected_at: '2026-08-01T10:00:00.000Z' },
  { keyword_id: 4, keyword: '정책자금', category: 'policy', collected_at: '2026-08-01T09:00:00.000Z' },
  { keyword_id: 5, keyword: '제외', category: 'local_commerce', collected_at: '2026-08-01T10:00:00.000Z' },
];

const selected = selectRisingKeywords(rows, { now, perCategory: 2 });
assert.deepEqual(selected.map((item) => item.keyword), ['AI 에이전트', '창업 지원', '정책자금']);
assert.equal(selected[0].recentCount, 2);
assert.equal(selected[0].growth, 2);
assert.equal(selected[0].score, 60);
const selection = selectCollectionKeywords([
  { id: 1, keyword: 'AI agent', category: 'ai_business' },
  { id: 2, keyword: 'AI security', category: 'ai_business' },
  { id: 3, keyword: 'startup support', category: 'startup' },
  { id: 4, keyword: 'policy fund', category: 'policy' },
  { id: 5, keyword: 'LLM', category: 'ai_business' },
], [
  { keyword_id: 3, keyword: 'startup support', category: 'startup', collected_at: '2026-08-01T10:00:00.000Z' },
  { keyword_id: 4, keyword: 'policy fund', category: 'policy', collected_at: '2026-08-01T10:00:00.000Z' },
], {
  limitKeywords: 4,
  coreKeywordCount: 2,
  rotatingKeywordCount: 2,
  risingPerCategory: 1,
  date: now,
});
assert.deepEqual(selection.core.map((item) => item.id), [1, 2]);
assert.deepEqual(selection.rising.map((item) => item.id), [3, 4]);
assert.deepEqual(selection.selected.map((item) => item.id), [1, 2, 3, 4]);
const endpoint = fs.readFileSync(require.resolve('../api/editorial/drafts'), 'utf8');
const dashboard = fs.readFileSync(require.resolve('../docs/vps-collector.html'), 'utf8');
const migration = fs.readFileSync(require.resolve('../supabase/migrations/20260801_refresh_coa_keyword_set.sql'), 'utf8');
assert.match(endpoint, /view === 'rising-keywords'/);
assert.match(endpoint, /listRisingKeywords/);
assert.match(endpoint, /eq\('added_by', 'manual'\)/);
assert.match(dashboard, /loadRisingKeywords/);
assert.match(dashboard, /risingKeywords/);
assert.equal((migration.match(/, 'manual'\)/g) || []).length, 54);
process.stdout.write('Rising keyword checks passed.\n');
