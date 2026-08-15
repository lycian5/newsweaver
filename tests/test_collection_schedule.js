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
const prepareRunnerCode = workflow.nodes.find((node) => node.name === 'Prepare runner')?.parameters?.jsCode || '';
assert.match(prepareRunnerCode, /this\.helpers\.httpRequest/);
assert.doesNotMatch(prepareRunnerCode, /fetch\(scheduleUrl\)/);
assert.match(alignmentMigration, /daily_time set default '16:30'/);
assert.match(alignmentMigration, /values \('agent_reach', true, '16:30'/);
assert.match(dashboard, /\/api\/operations\/schedule/);
assert.match(dashboard, /자동운영 일정/);
assert.match(dashboard, /07:10/);
assert.match(dashboard, /09:00/);
assert.match(dashboard, /16:30/);

const vercel = JSON.parse(fs.readFileSync(require.resolve('../vercel.json'), 'utf8'));
assert.deepEqual(vercel.crons.find((cron) => cron.path === '/api/cron/collect'), {
  path: '/api/cron/collect', schedule: '10 22 * * *',
});
assert.deepEqual(vercel.crons.find((cron) => cron.path === '/api/cron/collect-recovery'), {
  path: '/api/cron/collect-recovery', schedule: '0 0 * * *',
});

const recoveryEndpoint = fs.readFileSync(require.resolve('../api/cron/collect-recovery'), 'utf8');
assert.match(recoveryEndpoint, /recoveryDecision/);
assert.match(recoveryEndpoint, /previous_day_recovery/);

process.stdout.write('Collection schedule checks passed.\n');
