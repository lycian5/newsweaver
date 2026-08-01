const assert = require('node:assert/strict');
const { buildGithubQuery } = require('../scripts/agent-reach-collect');

assert.equal(buildGithubQuery({ keyword: 'AI 에이전트' }), 'AI agent automation');
assert.equal(buildGithubQuery({ keyword: '생성형 AI' }), 'LLM agent');
assert.equal(buildGithubQuery({ keyword: '업무 자동화' }), 'workflow automation AI');
assert.equal(buildGithubQuery({ keyword: 'AI 스타트업' }), 'AI SaaS');
assert.equal(buildGithubQuery({ keyword: 'AI 비즈니스' }), 'AI agent automation');

process.stdout.write('GitHub search query mapping checks passed.\n');
