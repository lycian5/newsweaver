const assert = require('node:assert/strict');
const { existsSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const usageFile = join(tmpdir(), `newsweaver-exa-test-${process.pid}.json`);
const previous = {
  EXA_API_KEY: process.env.EXA_API_KEY,
  AGENT_REACH_EXA_USAGE_FILE: process.env.AGENT_REACH_EXA_USAGE_FILE,
  AGENT_REACH_EXA_DAILY_REQUEST_LIMIT: process.env.AGENT_REACH_EXA_DAILY_REQUEST_LIMIT,
  AGENT_REACH_EXA_MONTHLY_BUDGET_USD: process.env.AGENT_REACH_EXA_MONTHLY_BUDGET_USD,
  AGENT_REACH_EXA_RESULTS: process.env.AGENT_REACH_EXA_RESULTS,
};
const previousFetch = global.fetch;
process.env.EXA_API_KEY = 'test-key';
process.env.AGENT_REACH_EXA_USAGE_FILE = usageFile;
process.env.AGENT_REACH_EXA_DAILY_REQUEST_LIMIT = '1';
process.env.AGENT_REACH_EXA_MONTHLY_BUDGET_USD = '8';
process.env.AGENT_REACH_EXA_RESULTS = '3';

const { collectExa } = require('../scripts/agent-reach-collect');

async function run() {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      async json() {
        return {
          costDollars: { total: 0.007 },
          results: [{
            title: 'AI policy update',
            url: 'https://example.com/news',
            publishedDate: '2026-08-02T00:00:00Z',
            highlights: ['A current public update.'],
          }],
        };
      },
    };
  };

  const keyword = { keyword: 'AI policy', category: 'policy' };
  const first = await collectExa(keyword);
  const second = await collectExa(keyword);
  const body = JSON.parse(request.options.body);

  assert.equal(request.url, 'https://api.exa.ai/search');
  assert.equal(request.options.headers['x-api-key'], 'test-key');
  assert.equal(body.category, 'news');
  assert.equal(body.numResults, 3);
  assert.equal(first.length, 1);
  assert.equal(first[0].source, 'agent_reach_exa');
  assert.equal(second.length, 0);
  assert.equal(existsSync(usageFile), true);
  console.log('Exa direct API and budget guard checks passed.');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (existsSync(usageFile)) rmSync(usageFile);
  });
