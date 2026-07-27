const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  DEFAULT_SCHEDULE,
  normalizeDailyTime,
  normalizeSchedule,
  scheduleFromRow,
} = require('../lib/collectionSchedule');

assert.equal(DEFAULT_SCHEDULE.dailyTime, '16:30');
assert.equal(normalizeDailyTime('06:30'), '06:30');
assert.equal(normalizeDailyTime('23:59:00'), '23:59');
assert.throws(() => normalizeDailyTime('24:00'), /HH:MM/);
assert.deepEqual(normalizeSchedule({ enabled: false, dailyTime: '08:05' }), {
  enabled: false, dailyTime: '08:05', timezone: 'Asia/Seoul',
});
assert.equal(scheduleFromRow({ enabled: true, daily_time: '07:45:00' }).dailyTime, '07:45');

const endpoint = fs.readFileSync(require.resolve('../api/operations/schedule'), 'utf8');
const migration = fs.readFileSync(require.resolve('../supabase/migrations/20260725_collection_schedule.sql'), 'utf8');
const alignmentMigration = fs.readFileSync(require.resolve('../supabase/migrations/20260727_align_collection_schedule.sql'), 'utf8');
const workflow = JSON.parse(fs.readFileSync(require.resolve('../n8n/workflow_agent_reach_collect.json'), 'utf8'));
const dashboard = fs.readFileSync(require.resolve('../docs/vps-collector.html'), 'utf8');
assert.match(endpoint, /assertCronAuth/);
assert.match(endpoint, /collection_schedules/);
assert.match(migration, /daily_time time/);
assert.equal(workflow.active, true);
assert.match(JSON.stringify(workflow), /16:30/);
assert.match(alignmentMigration, /daily_time set default '16:30'/);
assert.match(alignmentMigration, /values \('agent_reach', true, '16:30'/);
assert.match(dashboard, /\/api\/operations\/schedule/);
assert.match(dashboard, /권장 일과 후 발행 흐름/);
assert.match(dashboard, /16:30/);

process.stdout.write('Collection schedule checks passed.\n');
