const assert = require('node:assert/strict');

const source = require('node:fs').readFileSync(require.resolve('../api/cron/agent-reach'), 'utf8');
assert.match(source, /sanitizeOptions/);
assert.match(source, /allowedSources/);
assert.match(source, /'official'/);
assert.match(source, /'reddit'/);
assert.match(source, /officialResults/);
assert.match(source, /limitKeywords/);
assert.match(source, /AGENT_REACH_LIMIT_KEYWORDS \|\| 54/);
assert.match(source, /rssResults, 1, 20, 8/);
assert.match(source, /redditResults, 1, 25, 5/);
assert.match(source, /async: req\.method === 'POST'/);
assert.doesNotMatch(source, /\.\.\.req\.body/);
process.stdout.write('Agent Reach option forwarding checks passed.\n');
