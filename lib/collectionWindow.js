'use strict';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MODES = new Set(['previous_day', 'previous_day_recovery', 'all']);

function normalizeCollectionMode(value, fallback = 'previous_day') {
  const mode = String(value || fallback).trim().toLowerCase();
  return MODES.has(mode) ? mode : fallback;
}

function koreaDate(now = new Date()) {
  return new Date(toDate(now).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function previousKoreaDate(now = new Date()) {
  return shiftDate(koreaDate(now), -1);
}

function buildCollectionWindow({ mode, targetDate, now = new Date() } = {}) {
  const normalizedMode = normalizeCollectionMode(mode);
  if (normalizedMode === 'all') {
    return { mode: normalizedMode, targetDate: null, startAt: null, endAt: null };
  }

  const normalizedTargetDate = isDateOnly(targetDate) ? targetDate : previousKoreaDate(now);
  const nextDate = shiftDate(normalizedTargetDate, 1);
  return {
    mode: normalizedMode,
    targetDate: normalizedTargetDate,
    startAt: new Date(`${normalizedTargetDate}T00:00:00+09:00`).toISOString(),
    endAt: new Date(`${nextDate}T00:00:00+09:00`).toISOString(),
  };
}

function filterRowsForWindow(rows, window, { includeUndated = false } = {}) {
  const result = { rows: [], outsideWindow: 0, missingPublishedAt: 0, undatedIncluded: 0 };
  for (const row of rows || []) {
    if (!window?.startAt || !window?.endAt) {
      result.rows.push(row);
      continue;
    }
    const publishedAt = Date.parse(row.published_at || '');
    if (!Number.isFinite(publishedAt)) {
      if (includeUndated) {
        result.rows.push(row);
        result.undatedIncluded += 1;
      } else {
        result.missingPublishedAt += 1;
      }
      continue;
    }
    if (publishedAt >= Date.parse(window.startAt) && publishedAt < Date.parse(window.endAt)) {
      result.rows.push(row);
    } else {
      result.outsideWindow += 1;
    }
  }
  return result;
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date');
  return date;
}

module.exports = {
  buildCollectionWindow,
  filterRowsForWindow,
  koreaDate,
  normalizeCollectionMode,
  previousKoreaDate,
  shiftDate,
};
