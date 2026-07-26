const assert = require('node:assert/strict');
const { formatCollectionNotification, notifyCollectionResult } = require('../scripts/collection-notifications');

const result = {
  ok: true,
  summary: {
    keywordsProcessed: 54,
    rowsPrepared: 120,
    clustersAssigned: 40,
    readyBriefs: 12,
    factsExtracted: 30,
    failures: [],
  },
};

const text = formatCollectionNotification(result, { trigger: 'schedule' });
assert.match(text, /COA NEWS collection complete/);
assert.match(text, /Ready briefs: 12/);
assert.match(text, /automatic schedule/);

(async () => {
  let sent;
  const response = await notifyCollectionResult(result, { trigger: 'schedule' }, {
    webhookUrl: 'https://example.test/slack',
    fetchFn: async (_url, options) => {
      sent = JSON.parse(options.body);
      return { ok: true, status: 200 };
    },
  });
  assert.equal(response.sent, true);
  assert.match(sent.text, /Ready briefs: 12/);
  const skipped = await notifyCollectionResult(result, {}, { enabled: false });
  assert.deepEqual(skipped, { sent: false, reason: 'disabled' });
  process.stdout.write('Collection notification checks passed.\n');
})().catch((error) => { throw error; });
