'use strict';

const PRIMARY_CATEGORIES = new Set(['ai_business', 'startup', 'policy']);

function selectRisingKeywords(rows, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const recentHours = Number(options.recentHours || 24);
  const baselineDays = Number(options.baselineDays || 7);
  const perCategory = Number(options.perCategory || 2);
  const recentStart = now.getTime() - recentHours * 60 * 60 * 1000;
  const baselineStart = recentStart - baselineDays * 24 * 60 * 60 * 1000;
  const candidates = new Map();

  for (const row of rows || []) {
    const category = String(row.category || '');
    const keyword = String(row.keyword || '').trim();
    const collectedAt = new Date(row.collected_at).getTime();
    if (!PRIMARY_CATEGORIES.has(category) || !keyword || !Number.isFinite(collectedAt) || collectedAt < baselineStart) continue;

    const key = `${category}:${row.keyword_id || keyword}`;
    const candidate = candidates.get(key) || { category, keyword, recentCount: 0, baselineCount: 0 };
    if (collectedAt >= recentStart) candidate.recentCount += 1;
    else candidate.baselineCount += 1;
    candidates.set(key, candidate);
  }

  const ranked = [...candidates.values()]
    .filter((item) => item.recentCount > 0)
    .map((item) => {
      const baselineDaily = item.baselineCount / baselineDays;
      const growth = item.recentCount - baselineDaily;
      return {
        ...item,
        growth: Number(growth.toFixed(1)),
        score: Number((item.recentCount * 10 + Math.max(0, growth) * 20).toFixed(1)),
      };
    })
    .sort((a, b) => b.score - a.score || b.recentCount - a.recentCount || a.keyword.localeCompare(b.keyword, 'ko'));

  return ['ai_business', 'startup', 'policy'].flatMap((category) =>
    ranked.filter((item) => item.category === category).slice(0, perCategory)
  );
}

module.exports = { PRIMARY_CATEGORIES, selectRisingKeywords };
