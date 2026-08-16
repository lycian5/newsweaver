const assert = require('node:assert/strict');
const fs = require('node:fs');

const endpoint = fs.readFileSync(require.resolve('../api/editorial/drafts'), 'utf8');
const dashboard = fs.readFileSync(require.resolve('../docs/vps-collector.html'), 'utf8');

assert.match(endpoint, /assertCronAuth/);
assert.match(endpoint, /selectCollectionKeywords/);
assert.match(endpoint, /datalab_priority/);
assert.match(endpoint, /core: keywordSelection\.core/);
assert.match(endpoint, /rising: keywordSelection\.rising/);
assert.match(endpoint, /rotating: keywordSelection\.rotating/);
assert.match(dashboard, /핵심 키워드 12개/);
assert.match(dashboard, /순환 키워드 42개/);
assert.match(dashboard, /오늘 수집 상태/);
assert.match(dashboard, /수동 재수집/);
assert.match(endpoint, /view === 'keywords'/);
assert.match(endpoint, /view === 'collection-status'/);
assert.match(dashboard, /\/api\/editorial\/drafts\?view=keywords/);
assert.match(dashboard, /view=rising-keywords/);
assert.match(dashboard, /view=collection-status/);
assert.match(dashboard, /CoaAuth\.request/);
assert.doesNotMatch(dashboard, /CRON_SECRET/);

process.stdout.write('Keyword dashboard checks passed.\n');
