const NAVER_API_HUB_BASE_URL = 'https://naverapihub.apigw.ntruss.com';
const NAVER_LEGACY_NEWS_URL = 'https://openapi.naver.com/v1/search/news.json';
const NAVER_LEGACY_DATALAB_URL = 'https://openapi.naver.com/v1/datalab/search';

function naverConfig() {
  const apiHubClientId = process.env.NAVER_API_HUB_CLIENT_ID;
  const apiHubClientSecret = process.env.NAVER_API_HUB_CLIENT_SECRET;
  if (apiHubClientId && apiHubClientSecret) {
    return {
      newsUrl: `${NAVER_API_HUB_BASE_URL}/search/v1/news`,
      trendUrl: `${NAVER_API_HUB_BASE_URL}/search-trend/v1/search`,
      headers: {
        'X-NCP-APIGW-API-KEY-ID': apiHubClientId,
        'X-NCP-APIGW-API-KEY': apiHubClientSecret,
      },
      provider: 'api_hub',
    };
  }
  if (apiHubClientId || apiHubClientSecret) {
    throw new Error(
      'NAVER_API_HUB_CLIENT_ID와 NAVER_API_HUB_CLIENT_SECRET는 함께 설정해야 합니다.'
    );
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'NAVER_API_HUB_CLIENT_ID / NAVER_API_HUB_CLIENT_SECRET 또는 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 설정되지 않았습니다.'
    );
  }

  return {
    newsUrl: NAVER_LEGACY_NEWS_URL,
    trendUrl: NAVER_LEGACY_DATALAB_URL,
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
    provider: 'legacy',
  };
}

async function searchNews(keyword, { display = 20 } = {}) {
  const config = naverConfig();
  const url = `${config.newsUrl}?query=${encodeURIComponent(keyword)}&display=${display}&sort=date`;
  const res = await fetch(url, { headers: config.headers });
  if (!res.ok) {
    throw new Error(`네이버 뉴스 검색 실패 (${res.status}): ${keyword}`);
  }
  const data = await res.json();
  return data.items || [];
}

// keywordGroups: [{ groupName: '창업', keywords: ['창업'] }, ...] (최대 5개)
async function getDatalabTrend(keywordGroups, { startDate, endDate } = {}) {
  const end = endDate || new Date().toISOString().slice(0, 10);
  const start =
    startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const groups = keywordGroups.slice(0, 5);
  const config = naverConfig();
  const res = await fetch(config.trendUrl, {
    method: 'POST',
    headers: { ...config.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDate: start,
      endDate: end,
      timeUnit: 'date',
      keywordGroups: groups,
    }),
  });
  if (!res.ok) {
    throw new Error(`네이버 검색어 트렌드 조회 실패 (${res.status})`);
  }
  const data = await res.json();
  return data.results || [];
}

module.exports = { searchNews, getDatalabTrend, naverConfig };
