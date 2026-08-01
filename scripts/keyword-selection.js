'use strict';

const { selectRisingKeywords } = require('./rising-keywords');

function selectHybridKeywords(keywords, options = {}) {
  const limit = Math.max(0, Number.parseInt(options.limitKeywords, 10) || 0);
  if (!limit || !keywords.length) return [];

  const coreCount = Math.min(
    Math.max(0, Number.parseInt(options.coreKeywordCount, 10) || 0),
    limit,
    keywords.length
  );
  const core = keywords.slice(0, coreCount);
  const pool = keywords.slice(coreCount);
  const rotatingCount = Math.min(
    Math.max(0, Number.parseInt(options.rotatingKeywordCount, 10) || 0),
    Math.max(0, limit - core.length),
    pool.length
  );
  if (!rotatingCount) return core;

  const date = options.date instanceof Date ? options.date : new Date(options.date || Date.now());
  const utcOffsetMinutes = Number.isFinite(Number(options.utcOffsetMinutes))
    ? Number(options.utcOffsetMinutes)
    : 540;
  const localDate = new Date(date.getTime() + utcOffsetMinutes * 60000);
  const day = Math.floor(Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate()
  ) / 86400000);
  const start = (day * rotatingCount) % pool.length;
  const rotating = Array.from({ length: rotatingCount }, (_, index) => pool[(start + index) % pool.length]);
  return [...core, ...rotating];
}

function selectCollectionKeywords(keywords, articleRows, options = {}) {
  const selected = selectHybridKeywords(keywords, options);
  const coreCount = Math.min(Number.parseInt(options.coreKeywordCount, 10) || 0, selected.length);
  const core = selected.slice(0, coreCount);
  const rising = selectRisingKeywords(articleRows, {
    now: options.date,
    perCategory: options.risingPerCategory || 2,
  }).map((item) => ({
    ...item,
    id: item.keyword_id || keywords.find((keyword) => keyword.keyword === item.keyword && keyword.category === item.category)?.id || null,
  })).filter((item) => item.id);
  const seen = new Set();
  const take = (items) => items.filter((item) => !seen.has(item.id) && seen.add(item.id));
  const prioritized = [...take(core), ...take(rising), ...take(selected.slice(coreCount))];
  const limit = Math.max(0, Number.parseInt(options.limitKeywords, 10) || 0);
  const selectedKeywords = prioritized.slice(0, limit);
  const selectedIds = new Set(selectedKeywords.map((item) => item.id));
  return {
    selected: selectedKeywords,
    core,
    rising: rising.filter((item) => selectedIds.has(item.id) && !core.some((keyword) => keyword.id === item.id)),
    rotating: selectedKeywords.filter((item) => !core.some((keyword) => keyword.id === item.id) && !rising.some((keyword) => keyword.id === item.id)),
  };
}

module.exports = { selectHybridKeywords, selectCollectionKeywords };
