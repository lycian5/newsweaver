async function postBriefing(text) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL 환경변수가 설정되지 않았습니다.');
  }
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Slack 전송 실패 (${res.status}): ${body}`);
  }
}

module.exports = { postBriefing };
