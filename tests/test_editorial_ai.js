const assert = require('node:assert/strict');
const { buildEvidence, buildImagePrompt, normalizeArticlePayload, normalizeBriefReview, reviewDraftEvidence } = require('../lib/editorialAi');

const context = buildEvidence(
  { representative_title: '지원사업 공고', category: 'policy' },
  [{ title: '공고', url: 'https://example.go.kr/notice', summary: '공식 공고', source_type: 'official' }],
  [{ fact_text: '접수는 8월 1일까지', source_url: 'https://example.go.kr/notice', fact_type: 'date', is_official: true }]
);
assert.deepEqual(context.urls, ['https://example.go.kr/notice']);
const proposal = normalizeArticlePayload({
  title: '지원사업 공고', subtitles: ['접수 일정'], summary: '공식 공고를 정리했습니다.',
  body_html: '<p>내용</p><script>alert(1)</script>', tags: ['지원사업', '지원사업'], category_recommendation: 'policy', source_url: 'https://example.go.kr/notice',
  image_prompt: 'desk and documents', thumbnail_alt: '지원사업 서류', thumbnail_caption: '지원사업 관련 이미지',
  fact_checks: [{ claim: '접수 일정', source_url: 'https://example.go.kr/notice', status: 'supported' }], warnings: [],
}, context.urls);
assert.equal(proposal.body_html.includes('script'), false);
assert.equal(proposal.tags.length, 1);
assert.equal(proposal.fact_checks.length, 1);
assert.equal(buildImagePrompt({ title: '지원사업' }).includes('no text'), true);
const review = reviewDraftEvidence({ title: '제목', body_html: '<p>본문</p><a href="https://example.go.kr/notice">근거</a>'.repeat(30) }, context.urls);
assert.equal(review.ready, true);
const briefReview = normalizeBriefReview({
  verdict: 'needs_review',
  reason: '수치를 근거에서 확인할 수 없습니다.',
  issues: ['30억원 언급'],
  supported_points: ['중기부 발표'],
  missing_points: ['신청 기한'],
});
assert.equal(briefReview.verdict, 'needs_review');
assert.equal(briefReview.issues.length, 1);
assert.equal(normalizeBriefReview({ verdict: 'made_up' }).verdict, 'needs_review');
process.stdout.write('Editorial AI helper tests passed.\n');
