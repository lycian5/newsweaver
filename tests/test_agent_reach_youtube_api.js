const assert = require('node:assert/strict');
const previousKey = process.env.YOUTUBE_API_KEY;
const previousFetch = global.fetch;
process.env.YOUTUBE_API_KEY = 'test-key';

const { buildYoutubeSearchQuery, collectYoutube } = require('../scripts/agent-reach-collect');

async function run() {
  assert.equal(
    buildYoutubeSearchQuery({ keyword: 'AI 에이전트', category: 'ai_business' }),
    'AI 에이전트 AI 비즈니스 자동화 에이전트'
  );

  let requestUrl;
  global.fetch = async (url) => {
    requestUrl = new URL(url);
    return {
      ok: true,
      async json() {
        return {
          items: [{
            id: { videoId: 'video-1' },
            snippet: {
              title: 'AI agent update',
              description: 'Latest public video',
              publishedAt: '2026-08-01T00:00:00Z',
            },
          }],
        };
      },
    };
  };

  const rows = await collectYoutube({ keyword: 'AI 에이전트', category: 'ai_business' });
  assert.equal(requestUrl.hostname, 'www.googleapis.com');
  assert.equal(requestUrl.pathname, '/youtube/v3/search');
  assert.equal(requestUrl.searchParams.get('key'), 'test-key');
  assert.equal(requestUrl.searchParams.get('type'), 'video');
  assert.equal(requestUrl.searchParams.get('order'), 'date');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://www.youtube.com/watch?v=video-1');
  assert.equal(rows[0].source, 'agent_reach_youtube_api');
  console.log('YouTube Data API collector checks passed.');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previousKey;
  });
