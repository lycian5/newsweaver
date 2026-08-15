const assert = require('node:assert/strict');
const { buildCollectionWindow, filterRowsForWindow, previousKoreaDate } = require('../lib/collectionWindow');
const { median, recoveryDecision } = require('../lib/collectionRecovery');

const now = new Date('2026-08-15T00:00:00.000Z');
assert.equal(previousKoreaDate(now), '2026-08-14');

const window = buildCollectionWindow({ mode: 'previous_day', now });
assert.deepEqual(window, {
  mode: 'previous_day',
  targetDate: '2026-08-14',
  startAt: '2026-08-13T15:00:00.000Z',
  endAt: '2026-08-14T15:00:00.000Z',
});

const filtered = filterRowsForWindow([
  { title: 'inside', published_at: '2026-08-14T12:00:00+09:00' },
  { title: 'start', published_at: '2026-08-14T00:00:00+09:00' },
  { title: 'next day', published_at: '2026-08-15T00:00:00+09:00' },
  { title: 'undated', published_at: null },
], window);
assert.deepEqual(filtered.rows.map((row) => row.title), ['inside', 'start']);
assert.equal(filtered.outsideWindow, 1);
assert.equal(filtered.missingPublishedAt, 1);

const official = filterRowsForWindow([{ title: 'undated' }], window, { includeUndated: true });
assert.equal(official.rows.length, 1);
assert.equal(official.undatedIncluded, 1);

assert.equal(median([10, 30, 20]), 20);
assert.equal(median([10, 20]), 15);
assert.equal(recoveryDecision({ targetRuns: [], baselineRuns: [{ stored_count: 100 }] }).reason, 'main_run_missing');
assert.equal(recoveryDecision({
  targetRuns: [{ collection_mode: 'previous_day', status: 'succeeded', stored_count: 59, source_failures: [] }],
  baselineRuns: [{ stored_count: 100 }],
}).reason, 'stored_count_below_threshold');
assert.equal(recoveryDecision({
  targetRuns: [{ collection_mode: 'previous_day', status: 'succeeded', stored_count: 60, source_failures: [] }],
  baselineRuns: [{ stored_count: 100 }],
}).shouldRecover, false);
assert.equal(recoveryDecision({
  targetRuns: [{ collection_mode: 'previous_day_recovery', status: 'succeeded', stored_count: 10 }],
}).reason, 'recovery_already_succeeded');

process.stdout.write('Previous-day collection window checks passed.\n');
