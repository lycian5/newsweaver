'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { classificationFromDraft, mapPlatformCategory } = require('../lib/platformCategories');

assert.deepEqual(mapPlatformCategory('ai_business'), {
  category: '13',
  additionalCategory1: '16',
  additionalCategory2: '',
  tags: ['AI', 'AI비즈니스'],
});
assert.equal(mapPlatformCategory('policy').category, '17');
assert.equal(mapPlatformCategory('policy').additionalCategory1, '11');
assert.equal(mapPlatformCategory('local_commerce').category, '12');
assert.equal(mapPlatformCategory('marketing_distribution').category, '18');
assert.equal(mapPlatformCategory('field_issue').category, '14');
assert.equal(mapPlatformCategory('small_business_economy').category, '17');
assert.equal(mapPlatformCategory('unknown').category, '11');

const fromStored = classificationFromDraft({
  platform_category_id: '15',
  additional_category_1: '',
  tags: ['창업'],
  source_url: 'https://example.com/a',
}, 'startup');
assert.equal(fromStored.category, '15');
assert.equal(fromStored.sourceUrl, 'https://example.com/a');

const fromCluster = classificationFromDraft({}, 'ai_business');
assert.equal(fromCluster.category, '13');
assert.equal(fromCluster.additionalCategory1, '16');

const api = fs.readFileSync(require.resolve('../api/editorial/drafts'), 'utf8');
const page = fs.readFileSync(require.resolve('../docs/coanews-draft.html'), 'utf8');
assert.match(api, /mapPlatformCategory/);
assert.match(api, /attachDraftClassification/);
assert.match(api, /platform_category_id/);
assert.match(page, /applyClassification/);
assert.match(page, /small_business_economy/);
assert.doesNotMatch(page, /CATEGORY_DEFAULTS\[proposal\.category_recommendation\]/);

process.stdout.write('Platform category mapping checks passed.\n');
