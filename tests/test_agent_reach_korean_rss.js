'use strict';

const assert = require('node:assert/strict');
const { DEFAULT_FEEDS } = require('../lib/koreanNewsRss');
const {
  buildOfficialSearchQuery,
  isAgentReachKoreanRssEnabled,
  isOfficialDomain,
  resolveRssFeeds,
} = require('../scripts/agent-reach-collect');

const previous = {
  AGENT_REACH_RSS_FEEDS: process.env.AGENT_REACH_RSS_FEEDS,
  AGENT_REACH_KR_NEWS_RSS: process.env.AGENT_REACH_KR_NEWS_RSS,
};

try {
  delete process.env.AGENT_REACH_RSS_FEEDS;
  delete process.env.AGENT_REACH_KR_NEWS_RSS;

  const defaultFeeds = resolveRssFeeds({});
  assert.ok(defaultFeeds.some((feed) => /techcrunch/i.test(feed.url)));
  for (const feed of DEFAULT_FEEDS) {
    assert.ok(defaultFeeds.some((item) => item.url === feed.url), `missing ${feed.name}`);
  }

  const customOnly = resolveRssFeeds({
    AGENT_REACH_RSS_FEEDS: '단독피드|https://example.com/feed|startup',
    AGENT_REACH_KR_NEWS_RSS: 'false',
  });
  assert.deepEqual(customOnly.map((feed) => feed.url), ['https://example.com/feed']);

  const customPlusKorean = resolveRssFeeds({
    AGENT_REACH_RSS_FEEDS: '단독피드|https://example.com/feed|startup',
    AGENT_REACH_KR_NEWS_RSS: 'true',
  });
  assert.ok(customPlusKorean.some((feed) => feed.url === 'https://example.com/feed'));
  assert.ok(customPlusKorean.some((feed) => feed.url === 'https://www.yna.co.kr/rss/news.xml'));

  assert.equal(isAgentReachKoreanRssEnabled({}), true);
  assert.equal(isAgentReachKoreanRssEnabled({ AGENT_REACH_KR_NEWS_RSS: 'off' }), false);

  assert.match(buildOfficialSearchQuery({ keyword: '수수료', category: 'policy' }), /site:ftc\.go\.kr/);
  assert.match(buildOfficialSearchQuery({ keyword: '대출', category: 'small_business_economy' }), /site:bok\.or\.kr/);
  assert.equal(isOfficialDomain('https://www.bok.or.kr/portal/bbs/B0000133/view.do'), true);
  assert.equal(isOfficialDomain('https://www.ftc.go.kr/www/selectReportUserView.do'), true);

  process.stdout.write('Agent Reach Korean RSS and official domain checks passed.\n');
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
