const OpenAI = require('openai');

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY 환경변수가 설정되지 않았습니다.');
  }
  return new OpenAI({ apiKey });
}

module.exports = { getOpenAI };
