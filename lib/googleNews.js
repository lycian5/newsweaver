const cheerio = require('cheerio');

async function searchGoogleNews(keyword) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`구글 뉴스 RSS 조회 실패 (${res.status}): ${keyword}`);
  }
  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];
  $('item').each((_, el) => {
    const title = $(el).find('title').first().text();
    const link = $(el).find('link').first().text();
    const pubDate = $(el).find('pubDate').first().text();
    if (title && link) {
      items.push({ title, link, pubDate });
    }
  });
  return items;
}

module.exports = { searchGoogleNews };
