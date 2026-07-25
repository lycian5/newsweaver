const { assertCronAuth } = require('../../lib/cronAuth');

module.exports = async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    assertCronAuth(req);
  } catch (err) {
    res.status(err.statusCode || 401).json({ error: err.message });
    return;
  }

  const webhookUrl = process.env.AGENT_REACH_WEBHOOK_URL;
  if (!webhookUrl) {
    res.status(200).json({
      skipped: true,
      reason: 'AGENT_REACH_WEBHOOK_URL is not configured',
    });
    return;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.AGENT_REACH_WEBHOOK_SECRET) {
    headers.Authorization = `Bearer ${process.env.AGENT_REACH_WEBHOOK_SECRET}`;
    headers['X-Agent-Reach-Secret'] = process.env.AGENT_REACH_WEBHOOK_SECRET;
  }

  try {
    const options = req.method === 'POST' ? sanitizeOptions(req.body || {}) : {};
    const upstream = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: 'vercel-cron',
        requested_at: new Date().toISOString(),
        async: req.method === 'POST',
        ...options,
      }),
    });
    const text = await upstream.text();
    let body = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (_) {
      body = text.slice(0, 2000);
    }

    res.status(upstream.ok ? 200 : 502).json({
      ok: upstream.ok,
      upstreamStatus: upstream.status,
      body,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
};

function sanitizeOptions(body) {
  const allowedSources = new Set(['exa', 'official', 'rss', 'youtube', 'github']);
  const sources = Array.isArray(body.sources)
    ? body.sources.filter((source) => allowedSources.has(source))
    : String(body.sources || '')
        .split(',')
        .map((source) => source.trim())
        .filter((source) => allowedSources.has(source));

  const result = {};
  if (sources.length) result.sources = sources.join(',');
  result.limitKeywords = clampInteger(
    body.limitKeywords,
    1,
    100,
    Number(process.env.AGENT_REACH_LIMIT_KEYWORDS || 54)
  );
  result.exaResults = clampInteger(body.exaResults, 1, 10, 5);
  result.officialResults = clampInteger(body.officialResults, 1, 10, 3);
  result.rssResults = clampInteger(body.rssResults, 1, 20, 8);
  if (typeof body.keywords === 'string' && body.keywords.trim()) {
    result.keywords = body.keywords.trim().slice(0, 500);
  }
  return result;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
