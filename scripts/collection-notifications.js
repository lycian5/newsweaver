'use strict';

function formatCollectionNotification(result, request = {}) {
  const summary = result.summary || {};
  const failed = !result.ok;
  const trigger = request.trigger === 'schedule' ? 'automatic schedule' : 'manual run';
  const failures = Array.isArray(summary.failures) ? summary.failures : [];
  const lines = [
    failed ? 'COA NEWS collection failed' : 'COA NEWS collection complete',
    `Trigger: ${trigger}`,
    `Keywords processed: ${summary.keywordsProcessed ?? 0}`,
    `Unique materials: ${summary.rowsPrepared ?? 0}`,
    `Clusters updated: ${summary.clustersAssigned ?? 0}`,
    `Ready briefs: ${summary.readyBriefs ?? 0}`,
    `Facts extracted: ${summary.factsExtracted ?? 0}`,
  ];

  if (failures.length) lines.push(`Source failures: ${failures.length}`);
  if (failed && result.stderr) lines.push(`Error: ${oneLine(result.stderr, 500)}`);
  lines.push('Review briefs: https://newsweaver.vercel.app/research-briefs');
  return lines.join('\n');
}

async function notifyCollectionResult(result, request = {}, options = {}) {
  const webhookUrl = options.webhookUrl ?? process.env.SLACK_WEBHOOK_URL;
  const enabled = options.enabled ?? process.env.AGENT_REACH_NOTIFY_SLACK !== 'false';
  const fetchFn = options.fetchFn || globalThis.fetch;
  if (!enabled) return { sent: false, reason: 'disabled' };
  if (!webhookUrl) return { sent: false, reason: 'not_configured' };
  if (typeof fetchFn !== 'function') throw new Error('fetch is unavailable for Slack notification');

  const response = await fetchFn(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: formatCollectionNotification(result, request) }),
  });
  if (!response.ok) throw new Error(`Slack notification failed: HTTP ${response.status}`);
  return { sent: true };
}

function oneLine(value, limit) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

module.exports = { formatCollectionNotification, notifyCollectionResult };
