const assert = require('assert');

const previousEnv = {
  NAVER_API_HUB_CLIENT_ID: process.env.NAVER_API_HUB_CLIENT_ID,
  NAVER_API_HUB_CLIENT_SECRET: process.env.NAVER_API_HUB_CLIENT_SECRET,
  NAVER_CLIENT_ID: process.env.NAVER_CLIENT_ID,
  NAVER_CLIENT_SECRET: process.env.NAVER_CLIENT_SECRET,
};
const previousFetch = global.fetch;
const { searchNews, getDatalabTrend, naverConfig } = require('../lib/naver');

async function run() {
  process.env.NAVER_CLIENT_ID = 'legacy-id';
  process.env.NAVER_CLIENT_SECRET = 'legacy-secret';
  process.env.NAVER_API_HUB_CLIENT_ID = 'hub-id';
  process.env.NAVER_API_HUB_CLIENT_SECRET = 'hub-secret';

  const config = naverConfig();
  assert.strictEqual(config.provider, 'api_hub');
  assert.strictEqual(config.newsUrl, 'https://naverapihub.apigw.ntruss.com/search/v1/news');
  assert.strictEqual(config.trendUrl, 'https://naverapihub.apigw.ntruss.com/search-trend/v1/search');
  assert.deepStrictEqual(config.headers, {
    'X-NCP-APIGW-API-KEY-ID': 'hub-id',
    'X-NCP-APIGW-API-KEY': 'hub-secret',
  });

  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return {
      ok: true,
      async json() {
        return url.includes('search-trend') ? { results: [{ title: 'AI', data: [] }] } : { items: [{ title: 'AI news' }] };
      },
    };
  };

  assert.deepStrictEqual(await searchNews('AI'), [{ title: 'AI news' }]);
  assert.deepStrictEqual(await getDatalabTrend([{ groupName: 'AI', keywords: ['AI'] }]), [
    { title: 'AI', data: [] },
  ]);
  assert.ok(requests[0].url.startsWith('https://naverapihub.apigw.ntruss.com/search/v1/news?'));
  assert.strictEqual(requests[0].options.headers['X-NCP-APIGW-API-KEY-ID'], 'hub-id');
  assert.strictEqual(requests[1].url, 'https://naverapihub.apigw.ntruss.com/search-trend/v1/search');
  assert.strictEqual(requests[1].options.headers['X-NCP-APIGW-API-KEY'], 'hub-secret');

  delete process.env.NAVER_API_HUB_CLIENT_ID;
  delete process.env.NAVER_API_HUB_CLIENT_SECRET;
  assert.strictEqual(naverConfig().provider, 'legacy');
  console.log('NAVER API Hub selection and request paths passed.');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
