const assert = require('node:assert/strict');
const { formatCollectionNotification, notifyCollectionResult } = require('../scripts/collection-notifications');

const result = {
  ok: true,
  completedAt: '2026-07-30T07:42:00.000Z',
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
assert.match(text, /✅ COA NEWS 수집 완료/);
assert.match(text, /실행: 자동 수집/);
assert.match(text, /완료:/);
assert.match(text, /수집: 54개 키워드 · 120건 자료/);
assert.match(text, /작성 가능 브리프: 12건/);
assert.doesNotMatch(text, /Clusters updated|Facts extracted|Source failures|Error:/);

const failedText = formatCollectionNotification({
  ok: false,
  completedAt: result.completedAt,
  stderr: 'sensitive database error detail',
  summary: result.summary,
}, { trigger: 'schedule' });
assert.match(failedText, /⚠️ COA NEWS 수집 확인 필요/);
assert.match(failedText, /결과: 수집이 완료되지 않았습니다/);
assert.doesNotMatch(failedText, /sensitive database error detail|Keywords processed|Error:/);

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
  assert.match(sent.text, /작성 가능 브리프: 12건/);
  const skipped = await notifyCollectionResult(result, {}, { enabled: false });
  assert.deepEqual(skipped, { sent: false, reason: 'disabled' });
  process.stdout.write('Collection notification checks passed.\n');
})().catch((error) => { throw error; });
