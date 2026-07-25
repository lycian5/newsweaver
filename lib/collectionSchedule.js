'use strict';

const DEFAULT_SCHEDULE = Object.freeze({
  enabled: true,
  dailyTime: '06:30',
  timezone: 'Asia/Seoul',
});

function normalizeDailyTime(value) {
  const match = String(value || '').match(/^(?:[01]\d|2[0-3]):[0-5]\d/);
  if (!match) throw new Error('dailyTime must use HH:MM (24-hour) format');
  return match[0];
}

function normalizeSchedule(input = {}) {
  return {
    enabled: input.enabled !== false,
    dailyTime: normalizeDailyTime(input.dailyTime || input.daily_time || DEFAULT_SCHEDULE.dailyTime),
    timezone: DEFAULT_SCHEDULE.timezone,
  };
}

function scheduleFromRow(row) {
  if (!row) return { ...DEFAULT_SCHEDULE };
  return normalizeSchedule({
    enabled: row.enabled,
    dailyTime: row.daily_time,
  });
}

module.exports = {
  DEFAULT_SCHEDULE,
  normalizeDailyTime,
  normalizeSchedule,
  scheduleFromRow,
};
