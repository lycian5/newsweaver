const assert = require('node:assert/strict');
const fs = require('node:fs');
const { selectRisingKeywords } = require('../scripts/rising-keywords');

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
