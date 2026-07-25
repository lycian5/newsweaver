const assert = require('node:assert/strict');
const { resolveOpenAIModel } = require('../lib/openaiModels');

assert.equal(resolveOpenAIModel('suggest'), 'gpt-5-mini');
assert.equal(resolveOpenAIModel('suggest', 'gpt-5.4-mini'), 'gpt-5.4-mini');
assert.throws(() => resolveOpenAIModel('suggest', 'gpt-5.4'), /지원하지 않는/);

process.stdout.write('OpenAI model selection tests passed.\n');
