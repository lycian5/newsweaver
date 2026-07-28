const assert = require('node:assert/strict');
const fs = require('node:fs');

const api = fs.readFileSync(require.resolve('../api/editorial/drafts'), 'utf8');
const page = fs.readFileSync(require.resolve('../docs/research-briefs.html'), 'utf8');
const migration = fs.readFileSync(require.resolve('../supabase/migrations/20260728_optimize_research_briefs.sql'), 'utf8');

assert.match(api, /assertCronAuth/);
assert.match(api, /view === 'briefs'/);
assert.match(api, /view === 'brief'/);
assert.match(api, /editorial_state/);
assert.match(api, /independent_source_count/);
assert.match(api, /prepared_draft_id/);
assert.match(api, /start_review/);
assert.match(api, /status\(409\)/);
assert.match(api, /validateBriefForPreparation/);
assert.match(api, /action === 'prepare'/);

assert.match(page, /브리프 선별 큐/);
assert.match(page, /검증 후 기사 초안 준비/);
assert.match(page, /독립 발행처/);
assert.match(page, /view=brief&id=/);
assert.match(page, /CoaAuth\.request/);
assert.match(page, /editorialState/);
assert.doesNotMatch(page, /소재 초안/);
assert.doesNotMatch(page, /editorial-drafts/);
assert.doesNotMatch(page, /CRON_SECRET/);
assert.match(migration, /editorial_state/);
assert.match(migration, /independent_source_count/);
assert.match(migration, /prepared_draft_id/);

process.stdout.write('Research briefs checks passed.\n');
