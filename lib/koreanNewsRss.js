'use strict';

const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (compatible; CoaNewsBot/1.0)';

const DEFAULT_FEEDS = [
  { name: '연합뉴스', url: 'https://www.yna.co.kr/rss/news.xml', category: null },
  { name: '한국경제 IT', url: 'https://www.hankyung.com/feed/it', category: 'ai_business' },
  { name: '매일경제', url: 'https://www.mk.co.kr/rss/30000001/', category: null },
  { name: '조선비즈', url: 'https://biz.chosun.com/arc/outboundfeeds/rss/?outputType=xml', category: null },
  { name: '전자신문', url: 'https://rss.etnews.com/Section901.xml', category: 'ai_business' },
  { name: '뉴시스', url: 'https://www.newsis.com/RSS/sokbo.xml', category: null },
  { name: '플래텀', url: 'https://platum.kr/feed', category: 'startup' },
  { name: '벤처스퀘어', url: 'https://www.venturesquare.net/feed', category: 'startup' },
  { name: '바이라인네트워크', url: 'https://byline.network/feed/', category: 'ai_business' },
  { name: '더피알', url: 'https://www.the-pr.co.kr/rss/allArticle.xml', category: 'marketing_distribution' },
];

function isKoreanNewsRssEnabled(env = process.env) {
  return !isDisabled(env.BASE_COLLECT_KR_NEWS_RSS);
}

function parseFeeds(value, fallback = DEFAULT_FEEDS) {
  const text = String(value || '').trim();
  if (!text) return fallback.map((feed) => ({ ...feed }));
  return text.split(/[\n;,]+/).map((entry) => {
    const [name, url, category = ''] = entry.split('|').map((part) => String(part || '').trim());
    return { name, url, category: category || null };
  }).filter((feed) => feed.name && /^https?:\/\//i.test(feed.url));
}

function textOf($, el, tags) {
  for (const tag of tags) {
    const value = $(el).find(tag).first().text().trim();
    if (value) return value;
  }
  return '';
}

function linkOf($, el) {
  const href = $(el).find('link').first().attr('href');
  if (/^https?:\/\//i.test(href)) return href;
  const text = textOf($, el, ['link', 'guid', 'id']);
  return /^https?:\/\//i.test(text) ? text : '';
}

function parseRssXml(xml, feed, { maxItems = 20 } = {}) {
  const $ = cheerio.load(String(xml || ''), { xmlMode: true });
  const items = [];
  $('item, entry').each((_, el) => {
    if (items.length >= maxItems) return;
    const title = textOf($, el, ['title']);
    const url = linkOf($, el);
    const summary = textOf($, el, ['description', 'summary', 'content']);
    const publishedAt = textOf($, el, ['pubDate', 'published', 'updated', 'dc\\:date']);
    if (!title || !url) return;
    items.push({
      title,
      url,
      summary: stripTags(summary).slice(0, 700) || null,
      published_at: publishedAt || null,
      publisher_name: feed.name,
      feed_category: feed.category,
      source: `korean_news_rss:${feed.name}`,
    });
  });
  return items;
}

function matchesKeyword(entry, keyword) {
  const haystack = `${entry.title || ''} ${entry.summary || ''}`.toLowerCase();
  const phrase = String(keyword?.keyword || '').toLowerCase().trim();
  if (!phrase || !haystack) return false;
  if (haystack.includes(phrase)) return true;
  const compactHaystack = haystack.replace(/\s+/g, '');
  const compactPhrase = phrase.replace(/\s+/g, '');
  if (compactPhrase && compactHaystack.includes(compactPhrase)) return true;
  const terms = phrase.split(/\s+/).filter((term) => term.length >= 2);
  return terms.length >= 2 && terms.every((term) => haystack.includes(term));
}

function pickKeyword(entry, keywords) {
  const matches = (keywords || []).filter((keyword) => matchesKeyword(entry, keyword));
  if (!matches.length) return null;
  if (entry.feed_category) {
    const sameCategory = matches.find((keyword) => keyword.category === entry.feed_category);
    if (sameCategory) return sameCategory;
  }
  return matches[0];
}

function matchRssItemsToKeywords(items, keywords) {
  const rows = [];
  const seen = new Set();
  for (const item of items || []) {
    const keyword = pickKeyword(item, keywords);
    if (!keyword || seen.has(item.url)) continue;
    seen.add(item.url);
    rows.push({
      keyword_id: keyword.id || null,
      category: keyword.category,
      source: item.source,
      title: item.title,
      url: item.url,
      summary: item.summary,
      published_at: item.published_at,
      discovery_channel: 'korean_news_rss',
      publisher_name: item.publisher_name || null,
    });
  }
  return rows;
}

async function fetchKoreanNewsRss({
  feeds,
  maxPerFeed,
  fetchImpl = fetch,
  timeoutMs = Number(process.env.BASE_COLLECT_KR_NEWS_RSS_TIMEOUT_MS || 12000),
} = {}) {
  if (!isKoreanNewsRssEnabled()) return { items: [], failures: [] };
  const selectedFeeds = feeds || parseFeeds(process.env.BASE_COLLECT_KR_NEWS_RSS_FEEDS);
  const limit = clamp(maxPerFeed, 1, 50, Number(process.env.BASE_COLLECT_KR_NEWS_RSS_RESULTS || 20));
  const results = await Promise.allSettled(selectedFeeds.map((feed) => fetchOneFeed(feed, {
    maxItems: limit,
    fetchImpl,
    timeoutMs,
  })));

  const items = [];
  const failures = [];
  results.forEach((result, index) => {
    const feed = selectedFeeds[index];
    if (result.status === 'fulfilled') {
      items.push(...result.value);
      return;
    }
    failures.push({
      source: 'korean_news_rss',
      feed: feed.name,
      url: feed.url,
      error: String(result.reason?.message || result.reason || 'unknown'),
    });
  });
  return { items, failures };
}

async function fetchOneFeed(feed, { maxItems, fetchImpl, timeoutMs }) {
  const res = await fetchImpl(feed.url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  if (!/<(item|entry)[\s>]/i.test(xml)) {
    throw new Error('RSS 형식이 아닙니다');
  }
  return parseRssXml(xml, feed, { maxItems });
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isDisabled(value) {
  return /^(0|false|off|no)$/i.test(String(value || '').trim());
}

function clamp(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

module.exports = {
  DEFAULT_FEEDS,
  fetchKoreanNewsRss,
  isKoreanNewsRssEnabled,
  matchRssItemsToKeywords,
  matchesKeyword,
  parseFeeds,
  parseRssXml,
  pickKeyword,
};
