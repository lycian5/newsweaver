const cheerio = require('cheerio');

// 기획서 3.2절 "정책·지원사업 특화 소스" 목록 페이지.
// 각 사이트가 정식 RSS/Open API를 제공하지 않아 목록 페이지의 링크를 직접 파싱한다.
// 아래 "긴 텍스트 링크만 추출" 방식은 사이트별 실제 HTML 구조를 확인하기 전까지의 1차 근사치이며,
// 운영하면서 사이트별로 더 정확한 선택자로 다듬어야 한다.
const POLICY_LIST_PAGES = [
  { name: '정책브리핑', url: 'https://www.korea.kr/briefing/pressReleaseList.do' },
  { name: '중소벤처기업부', url: 'https://www.mss.go.kr/site/smba/main.do' },
  { name: '고용노동부', url: 'https://www.moel.go.kr/news/enews/list.do' },
  { name: '기업마당(Bizinfo)', url: 'https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/list.do' },
  { name: '소상공인시장진흥공단', url: 'https://www.semas.or.kr/web/main/index.kmdc' },
  { name: 'K-Startup', url: 'https://www.k-startup.go.kr' },
];

function resolveUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

async function fetchPolicyNotices(maxPerSource = 10) {
  const results = [];

  for (const site of POLICY_LIST_PAGES) {
    try {
      const res = await fetch(site.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CoaNewsBot/1.0)' },
      });
      if (!res.ok) {
        console.error(`[policySources] ${site.name} 응답 실패 (${res.status})`);
        continue;
      }
      const html = await res.text();
      const $ = cheerio.load(html);
      let count = 0;

      $('a').each((_, el) => {
        if (count >= maxPerSource) return;
        const text = $(el).text().trim().replace(/\s+/g, ' ');
        const href = $(el).attr('href');
        if (!text || text.length < 10 || !href) return;
        const url = resolveUrl(href, site.url);
        if (!url) return;
        results.push({ source: site.name, title: text, url });
        count += 1;
      });
    } catch (err) {
      console.error(`[policySources] ${site.name} 수집 실패:`, err.message);
    }
  }

  return results;
}

module.exports = { fetchPolicyNotices, POLICY_LIST_PAGES };
