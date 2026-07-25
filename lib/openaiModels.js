const MODEL_DEFAULTS = Object.freeze({
  classify: 'gpt-5.4-nano',
  suggest: 'gpt-5-mini',
  draft: 'gpt-5-mini',
  premium: 'gpt-5.4-mini',
});

const ALLOWED_MODELS = new Set([
  'gpt-5.4-nano',
  'gpt-5-mini',
  'gpt-5.4-mini',
]);

function resolveOpenAIModel(task, requestedModel) {
  const envName = `OPENAI_MODEL_${task.toUpperCase()}`;
  const model = requestedModel || process.env[envName] || MODEL_DEFAULTS[task];

  if (!model || !ALLOWED_MODELS.has(model)) {
    throw new Error(
      `지원하지 않는 OpenAI 모델입니다: ${model || '(비어 있음)'}. ` +
        `허용 모델: ${Array.from(ALLOWED_MODELS).join(', ')}`
    );
  }

  return model;
}

module.exports = { ALLOWED_MODELS, MODEL_DEFAULTS, resolveOpenAIModel };
