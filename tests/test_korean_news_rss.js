'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  DEFAULT_FEEDS,
  fetchKoreanNewsRss,
  isKoreanNewsRssEnabled,
  matchRssItemsToKeywords,
  matchesKeyword,
  parseFeeds,
  parseRssXml,
  pickKeyword,
} = require('../lib/koreanNewsRss');

const previous = process.env.BASE_COLLECT_KR_NEWS_RSS;

async function run() {
  assert.ok(DEFAULT_FEEDS.length >= 8);
  assert.ok(DEFAULT_FEEDS.every((feed) => feed.name && /^https:\/\//.test(feed.url)));

  const feeds = parseFeeds('전자신문|https://rss.etnews.com/Section901.xml|ai_business;플래텀|https://platum.kr/feed|startup');
  assert.equal(feeds.length, 2);
  assert.equal(feeds[1].category, 'startup');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title><![CDATA[생성형 AI 에이전트, 소상공인 업무 자동화]]></title>
      <link>https://www.etnews.com/202608140001</link>
      <description><![CDATA[소상공인이 생성형 AI를 매장 운영에 활용한다.]]></description>
      <pubDate>Fri, 14 Aug 2026 01:00:00 +0900</pubDate>
    </item>
    <item>
      <title>프로야구 경기 결과</title>
      <link>https://www.etnews.com/sports</link>
      <pubDate>Fri, 14 Aug 2026 02:00:00 +0900</pubDate>
    </item>
  </channel>
</rss>`;

  const parsed = parseRssXml(xml, { name: '전자신문', category: 'ai_business' });
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].publisher_name, '전자신문');
  assert.equal(parsed[0].url, 'https://www.etnews.com/202608140001');

  const keywords = [
    { id: 1, keyword: '생성형 AI', category: 'ai_business' },
    { id: 2, keyword: '소상공인', category: 'small_business_economy' },
  ];
  assert.equal(matchesKeyword(parsed[0], keywords[0]), true);
  assert.equal(matchesKeyword(parsed[1], keywords[0]), false);
  assert.equal(pickKeyword(parsed[0], keywords).id, 1);

  const rows = matchRssItemsToKeywords(parsed, keywords);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'korean_news_rss:전자신문');
  assert.equal(rows[0].discovery_channel, 'korean_news_rss');
  assert.equal(rows[0].keyword_id, 1);
  assert.equal(rows[0].category, 'ai_business');

  process.env.BASE_COLLECT_KR_NEWS_RSS = 'off';
  assert.equal(isKoreanNewsRssEnabled(), false);
  assert.deepEqual(await fetchKoreanNewsRss(), { items: [], failures: [] });

  process.env.BASE_COLLECT_KR_NEWS_RSS = 'true';
  const fetched = await fetchKoreanNewsRss({
    feeds: [{ name: '전자신문', url: 'https://rss.etnews.com/Section901.xml', category: 'ai_business' }],
    fetchImpl: async () => ({
      ok: true,
      async text() { return xml; },
    }),
  });
  assert.equal(fetched.items.length, 2);
  assert.equal(fetched.failures.length, 0);

  const failed = await fetchKoreanNewsRss({
    feeds: [{ name: '전자신문', url: 'https://rss.etnews.com/Section901.xml', category: 'ai_business' }],
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(failed.items.length, 0);
  assert.equal(failed.failures[0].source, 'korean_news_rss');

  const cron = fs.readFileSync(require.resolve('../api/cron/collect.js'), 'utf8');
  assert.match(cron, /fetchKoreanNewsRss/);
  assert.match(cron, /matchRssItemsToKeywords/);
  assert.match(cron, /korean_news_rss/);

  process.stdout.write('Korean news RSS source checks passed.\n');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (previous === undefined) delete process.env.BASE_COLLECT_KR_NEWS_RSS;
    else process.env.BASE_COLLECT_KR_NEWS_RSS = previous;
  });
