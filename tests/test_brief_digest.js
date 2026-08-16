'use strict';

const assert = require('node:assert/strict');
const { attachStoredReview, reviewMatchesSummary, summaryHash } = require('../lib/briefSummaryReviewJob');
const {
  buildBriefDigest,
  collapseFacts,
  collapseSources,
  extraLabel,
  stripOutlet,
} = require('../lib/briefDigest');

assert.equal(stripOutlet("두배로 키운 2차 '모두의창업' 이달 시행 - 머니투데이"), "두배로 키운 2차 '모두의창업' 이달 시행");
assert.equal(extraLabel('기업마당 지원사업 공고', 13), '기업마당 지원사업 공고 외 13건');

const fragments = collapseFacts([
  { fact_type: 'number', fact_text: '2배', is_official: false },
  { fact_type: 'number', fact_text: '7년', is_official: false },
  { fact_type: 'number', fact_text: '30억원', is_official: true },
  { fact_type: 'number', fact_text: '30억 원', is_official: false },
  { fact_type: 'organization', fact_text: '중소벤처기업부', is_official: true },
  { fact_type: 'quote', fact_text: '국가창업열풍 지속', is_official: false },
]);
assert.equal(fragments.some((item) => item.fact_text === '2배'), false);
assert.ok(fragments.some((item) => item.fact_text.includes('30억')));
assert.ok(fragments.some((item) => item.fact_text === '중소벤처기업부'));
assert.equal(fragments.filter((item) => item.fact_text.includes('30억')).length, 1);

const articles = [
  { title: '기업마당>정책정보>지원사업 공고', url: 'https://www.bizinfo.go.kr/a', source_domain: 'bizinfo.go.kr', source_type: 'official', authority_score: 95, quality_score: 80, summary: '중소벤처기업부는 소상공인 재기 지원 사업을 확대한다고 밝혔다. 폐업 후 재창업을 준비하는 사업자에게 컨설팅과 정책자금을 연계한다. 신청은 기업마당에서 받는다.' },
  { title: '기업마당>정책정보>지원사업 공고', url: 'https://www.bizinfo.go.kr/b', source_domain: 'bizinfo.go.kr', source_type: 'official', authority_score: 95, quality_score: 70, summary: '중소벤처기업부는 소상공인 재기 지원 사업을 확대한다고 밝혔다. 폐업 후 재창업을 준비하는 사업자에게 컨설팅과 정책자금을 연계한다.' },
  { title: '중진공, 재창업 정보 제공한다', url: 'https://www.mk.co.kr/c', source_domain: 'mk.co.kr', source_type: 'media', authority_score: 55, quality_score: 60, summary: '중소벤처기업진흥공단은 사업정리부터 재창업까지 단계별 정보를 한곳에서 볼 수 있게 안내 페이지를 열었다. 폐업 진단과 재기 교육 일정도 함께 공개했다.' },
];
const sources = collapseSources(articles);
assert.equal(sources.length, 2);
assert.match(sources[0].label, /외 1건/);

const digest = buildBriefDigest({
  category: 'policy',
  representative_title: '기업마당>정책정보>지원사업 공고',
  last_seen_at: new Date().toISOString(),
}, articles, [
  { fact_type: 'organization', fact_text: '중소벤처기업부', is_official: true },
  { fact_type: 'date', fact_text: '2026년 8월', is_official: true },
  { fact_type: 'number', fact_text: '2배' },
], { stage: 'ready', warnings: [], blockers: [] });

assert.equal(digest.decision.label, '작성 가능');
assert.equal(digest.decision.needs_source_read, false);
assert.ok(digest.preview);
assert.match(digest.summary, /소상공인 재기 지원/);
assert.match(digest.summary, /재창업/);
assert.ok(digest.summary.length > 80);
assert.ok(digest.highlights.some((row) => row.label === '기관' && row.value.includes('중소벤처기업부')));
assert.ok(digest.highlights.some((row) => row.label === '출처' && /외 \d+건/.test(row.value)));
assert.doesNotMatch(digest.summary, /2배/);

const held = buildBriefDigest({
  category: 'startup',
  representative_title: "두배로 키운 2차 '모두의창업' 이달 시행 - 머니투데이",
}, [{
  title: "두배로 키운 2차 '모두의창업' 이달 시행 - 머니투데이",
  url: 'https://news.mt.co.kr/1',
  source_domain: 'news.mt.co.kr',
  source_type: 'media',
  summary: '민간 스타트업 지원 프로그램 모두의창업 2차가 이달 시행된다. 선발 기업에는 투자 연계와 멘토링이 제공된다.',
}], [], { stage: 'reviewable', warnings: ['등급 A·B 출처가 없습니다.'], blockers: [] });
assert.equal(held.title.includes('머니투데이'), false);
assert.equal(held.decision.label, '작성 보류');
assert.match(held.summary, /모두의창업 2차/);

const thin = buildBriefDigest({
  category: 'startup',
  representative_title: '원문 없는 가능 소재 - 매일경제',
}, [{
  title: '원문 없는 가능 소재 - 매일경제',
  url: 'https://www.mk.co.kr/thin',
  source_domain: 'mk.co.kr',
  source_type: 'media',
  authority_score: 55,
  quality_score: 60,
  summary: null,
}], [], { stage: 'ready', warnings: [], blockers: [] });
assert.equal(thin.decision.label, '작성 가능 · 원문 확인');
assert.equal(thin.decision.needs_source_read, true);

const hashed = summaryHash('같은 요약');
assert.equal(hashed.length, 64);
assert.equal(reviewMatchesSummary({ summary_hash: hashed }, '같은 요약'), true);
assert.equal(reviewMatchesSummary({ summary_hash: hashed }, '다른 요약'), false);
assert.equal(attachStoredReview({
  validation_snapshot: { ai_summary_review: { verdict: 'supported', summary_hash: hashed } },
}, { summary: '같은 요약' }).verdict, 'supported');
assert.equal(attachStoredReview({
  validation_snapshot: { ai_summary_review: { verdict: 'supported', summary_hash: hashed } },
}, { summary: '다른 요약' }), null);

const agent = require('node:fs').readFileSync(require.resolve('../scripts/agent-reach-collect'), 'utf8');
assert.match(agent, /reviewBriefsAfterCollection/);

process.stdout.write('Brief digest checks passed.\n');
