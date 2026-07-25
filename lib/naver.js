const NAVER_NEWS_URL = 'https://openapi.naver.com/v1/search/news.json';
const NAVER_DATALAB_URL = 'https://openapi.naver.com/v1/datalab/search';

function naverHeaders() {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 설정되지 않았습니다.');
  }
  return {
    'X-Naver-Client-Id': clientId,
    'X-Naver-Client-Secret': clientSecret,
  };
}

async function searchNews(keyword, { display = 20 } = {}) {
  const url = `${NAVER_NEWS_URL}?query=${encodeURIComponent(keyword)}&display=${display}&sort=date`;
  const res = await fetch(url, { headers: naverHeaders() });
  if (!res.ok) {
    throw new Error(`네이버 뉴스 검색 실패 (${res.status}): ${keyword}`);
  }
  const data = await res.json();
  return data.items || [];
}

// keywordGroups 예: [{ groupName: '창업', keywords: ['창업'] }, ...] (최대 5개)
async function getDatalabTrend(keywordGroups, { startDate, endDate } = {}) {
  const end = endDate || new Date().toISOString().slice(0, 10);
  const start =
    startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const groups = keywordGroups.slice(0, 5); // 데이터랩 API 제약: 요청당 그룹 최대 5개

  const res = await fetch(NAVER_DATALAB_URL, {
    method: 'POST',
    headers: { ...naverHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDate: start,
      endDate: end,
      timeUnit: 'date',
      keywordGroups: groups,
    }),
  });
  if (!res.ok) {
    throw new Error(`네이버 데이터랩 조회 실패 (${res.status})`);
  }
  const data = await res.json();
  return data.results || [];
}

module.exports = { searchNews, getDatalabTrend };
