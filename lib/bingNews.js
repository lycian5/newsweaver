'use strict';

const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (compatible; CoaNewsBot/1.0)';

function isBingNewsEnabled(env = process.env) {
  return !isDisabled(env.BASE_COLLECT_BING_NEWS);
}

function unwrapBingUrl(link) {
  const text = String(link || '').trim();
  try {
    const url = new URL(text);
    if (isBingHost(url.hostname) && url.searchParams.has('url')) {
      const original = url.searchParams.get('url');
      if (/^https?:\/\//i.test(original)) return original;
      return '';
    }
    if (isBingHost(url.hostname)) return '';
    return text;
  } catch {
    return '';
  }
}

function isBingHost(hostname) {
  return /(^|\.)bing\.com$/i.test(String(hostname || ''));
}

function sourceNameFromItem($, el) {
  const named = $(el).children().filter((_, child) => {
    const tag = String(child.tagName || child.name || '');
    return /(?:^|:)source$/i.test(tag);
  }).first();
  return named.text().trim();
}

function parseBingNewsRss(xml, { maxItems = 20 } = {}) {
  const $ = cheerio.load(String(xml || ''), { xmlMode: true });
  const items = [];
  $('item').each((_, el) => {
    if (items.length >= maxItems) return;
    const title = $(el).find('title').first().text().trim();
    const link = unwrapBingUrl($(el).find('link').first().text());
    const pubDate = $(el).find('pubDate').first().text().trim();
    const description = $(el).find('description').first().text().trim();
    const sourceName = sourceNameFromItem($, el);
    if (title && link) {
      items.push({ title, link, pubDate, description, sourceName, sourceUrl: '' });
    }
  });
  return items;
}

async function searchBingNews(keyword, { maxItems, fetchImpl = fetch } = {}) {
  if (!isBingNewsEnabled()) return [];
  const limit = clamp(maxItems, 1, 50, Number(process.env.BASE_COLLECT_BING_RESULTS || 20));
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(keyword)}&format=rss&setlang=ko-KR&cc=KR`;
  const res = await fetchImpl(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  });
  if (!res.ok) {
    throw new Error(`빙 뉴스 RSS 조회 실패 (${res.status}): ${keyword}`);
  }
  const xml = await res.text();
  if (!/<item[\s>]/i.test(xml)) {
    throw new Error(`빙 뉴스 RSS 형식이 아닙니다: ${keyword}`);
  }
  return parseBingNewsRss(xml, { maxItems: limit });
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
  isBingNewsEnabled,
  parseBingNewsRss,
  searchBingNews,
  unwrapBingUrl,
};
