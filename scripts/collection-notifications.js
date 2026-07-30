'use strict';

const BRIEF_REVIEW_URL = 'https://newsweaver.vercel.app/research-briefs?freshness=7d&editorialState=unreviewed&sort=attention';

function formatCollectionNotification(result, request = {}) {
  const summary = result.summary || {};
  const successful = result.ok;
  const trigger = request.trigger === 'schedule' ? '자동 수집' : '수동 실행';
  const lines = [
    successful ? '✅ COA NEWS 수집 실행 성공' : '⚠️ COA NEWS 수집 확인 필요',
    `실행: ${trigger}`,
    `완료: ${formatCompletedAt(result.completedAt)}`,
  ];

  if (successful) {
    const materials = summary.rowsUpserted ?? summary.rowsPrepared ?? 0;
    lines.push(`수집: ${summary.keywordsProcessed ?? 0}개 키워드 · ${materials}건 자료`);
    lines.push(`브리프 반영: ${(summary.clustersAssigned ?? 0) > 0 ? '있음' : '없음'} · 작성 가능 ${summary.readyBriefs ?? 0}건`);
  } else {
    lines.push('결과: 수집이 완료되지 않았습니다. 서버 로그를 확인하세요.');
  }
  lines.push(`브리프 확인: ${BRIEF_REVIEW_URL}`);
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

function formatCompletedAt(value) {
  const completedAt = value ? new Date(value) : new Date();
  if (Number.isNaN(completedAt.getTime())) return '확인 필요';
  return `${completedAt.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })} KST`;
}

module.exports = { formatCollectionNotification, notifyCollectionResult };
