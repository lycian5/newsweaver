'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  isBingNewsEnabled,
  parseBingNewsRss,
  searchBingNews,
  unwrapBingUrl,
} = require('../lib/bingNews');

const previous = process.env.BASE_COLLECT_BING_NEWS;

async function run() {
  assert.equal(
    unwrapBingUrl('http://www.bing.com/news/apiclick.aspx?ref=FexRss&url=https%3a%2f%2fwww.news1.kr%2findustry%2f6259381&c=1'),
    'https://www.news1.kr/industry/6259381'
  );
  assert.equal(unwrapBingUrl('https://www.hankyung.com/article/202608141234'), 'https://www.hankyung.com/article/202608141234');
  assert.equal(unwrapBingUrl('https://www.bing.com/news/apiclick.aspx?ref=FexRss'), '');

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:News="https://www.bing.com/news/search">
  <channel>
    <item>
      <title>소상공인 지원금 확대</title>
      <link>http://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fwww.yna.co.kr%2fview%2fAKR20260814</link>
      <description>정부가 소상공인 지원 규모를 늘렸다.</description>
      <pubDate>Fri, 14 Aug 2026 23:25:00 GMT</pubDate>
      <News:Source>연합뉴스</News:Source>
    </item>
    <item>
      <title>추적 URL만 있는 기사</title>
      <link>https://www.bing.com/news/apiclick.aspx?ref=FexRss</link>
      <pubDate>Fri, 14 Aug 2026 23:25:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

  const items = parseBingNewsRss(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '소상공인 지원금 확대');
  assert.equal(items[0].link, 'https://www.yna.co.kr/view/AKR20260814');
  assert.equal(items[0].sourceName, '연합뉴스');
  assert.match(items[0].description, /지원 규모/);

  process.env.BASE_COLLECT_BING_NEWS = 'false';
  assert.equal(isBingNewsEnabled(), false);
  assert.deepEqual(await searchBingNews('소상공인'), []);

  process.env.BASE_COLLECT_BING_NEWS = 'true';
  const fetched = await searchBingNews('소상공인', {
    fetchImpl: async () => ({
      ok: true,
      async text() { return xml; },
    }),
  });
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].link, 'https://www.yna.co.kr/view/AKR20260814');

  const cron = fs.readFileSync(require.resolve('../api/cron/collect.js'), 'utf8');
  assert.match(cron, /searchBingNews/);
  assert.match(cron, /source: 'bing_news'/);

  process.stdout.write('Bing news source checks passed.\n');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (previous === undefined) delete process.env.BASE_COLLECT_BING_NEWS;
    else process.env.BASE_COLLECT_BING_NEWS = previous;
  });
