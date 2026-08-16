const assert = require('node:assert/strict');
const fs = require('node:fs');

const baseCollector = fs.readFileSync(require.resolve('../api/cron/collect'), 'utf8');
const agentCollector = fs.readFileSync(require.resolve('../scripts/agent-reach-collect'), 'utf8');
const compose = fs.readFileSync(require.resolve('../deploy/n8n/docker-compose.yml'), 'utf8');
const legacyCollect = JSON.parse(fs.readFileSync(require.resolve('../n8n/workflow_collect.json'), 'utf8'));
const legacySuggest = JSON.parse(fs.readFileSync(require.resolve('../n8n/workflow_suggest.json'), 'utf8'));
const standard = fs.readFileSync(require.resolve('../docs/OPERATING_STANDARD.md'), 'utf8');

assert.match(baseCollector, /BASE_COLLECT_LIMIT_KEYWORDS \|\| 18/);
assert.match(baseCollector, /BASE_COLLECT_CORE_KEYWORDS \|\| 6/);
assert.match(baseCollector, /BASE_COLLECT_ROTATING_KEYWORDS \|\| 12/);
assert.match(baseCollector, /searchBingNews/);
assert.match(baseCollector, /fetchKoreanNewsRss/);
assert.match(standard, /Naver·Google·Bing 뉴스와 국내 언론 RSS/);
assert.match(agentCollector, /AGENT_REACH_LIMIT_KEYWORDS, 54/);
assert.match(agentCollector, /AGENT_REACH_CORE_KEYWORDS, 12/);
assert.match(agentCollector, /AGENT_REACH_ROTATING_KEYWORDS, 42/);
assert.match(agentCollector, /DEFAULT_SOURCES = \['exa', 'official', 'rss'\]/);
assert.match(agentCollector, /KOREAN_NEWS_FEEDS/);
assert.match(agentCollector, /resolveRssFeeds/);
assert.match(agentCollector, /const rssFeedCache = new Map\(\)/);
assert.match(agentCollector, /loadRssEntries\(feed\)/);
assert.match(standard, /국내 언론 RSS/);
assert.match(standard, /공정위·통계청·한은/);
assert.match(compose, /n8nio\/n8n:\$\{N8N_VERSION:-2\.30\.7\}/);
assert.equal(legacyCollect.active, false);
assert.equal(legacySuggest.active, false);
assert.match(standard, /리서치 검증 기준/);
assert.match(standard, /등록용 기사 준비 화면으로 넘겨 실제 본문을 작성합니다/);
assert.doesNotMatch(standard, /맥락 요약/);
assert.match(standard, /원시 수집 단계에서는 OpenAI를 호출하지 않습니다/);

process.stdout.write('Operating standard checks passed.\n');
