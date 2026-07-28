const assert = require('node:assert/strict');
const {
  buildOfficialSearchQuery,
  buildRedditSearchQuery,
  classifySource,
  dateDistanceDays,
  eventFingerprint,
  extractFacts,
  isOfficialDomain,
  findMatchingCluster,
  normalizeUrl,
  scoreEvidence,
  scoreQuality,
  titleSimilarity,
} = require('../scripts/agent-reach-collect');
const { selectHybridKeywords } = require('../scripts/keyword-selection');

const keywordPool = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, keyword: `keyword-${index + 1}` }));
const hybridDayOne = selectHybridKeywords(keywordPool, {
  limitKeywords: 6,
  coreKeywordCount: 4,
  rotatingKeywordCount: 2,
  date: new Date('2026-07-14T00:00:00Z'),
});
const hybridDayTwo = selectHybridKeywords(keywordPool, {
  limitKeywords: 6,
  coreKeywordCount: 4,
  rotatingKeywordCount: 2,
  date: new Date('2026-07-15T00:00:00Z'),
});
assert.equal(hybridDayOne.length, 6);
assert.deepEqual(hybridDayOne.slice(0, 4).map((item) => item.id), [1, 2, 3, 4]);
assert.deepEqual(hybridDayTwo.slice(0, 4).map((item) => item.id), [1, 2, 3, 4]);
assert.notDeepEqual(hybridDayOne.slice(4).map((item) => item.id), hybridDayTwo.slice(4).map((item) => item.id));
const beforeKoreaMidnight = selectHybridKeywords(keywordPool, {
  limitKeywords: 6,
  coreKeywordCount: 4,
  rotatingKeywordCount: 2,
  date: new Date('2026-07-14T14:59:00Z'),
});
const afterKoreaMidnight = selectHybridKeywords(keywordPool, {
  limitKeywords: 6,
  coreKeywordCount: 4,
  rotatingKeywordCount: 2,
  date: new Date('2026-07-14T15:01:00Z'),
});
assert.notDeepEqual(beforeKoreaMidnight.slice(4).map((item) => item.id), afterKoreaMidnight.slice(4).map((item) => item.id));

assert.equal(normalizeUrl('HTTPS://Example.com/a?utm_source=x&id=1#top'), 'https://example.com/a?id=1');
assert.deepEqual(classifySource('rss', 'https://www.korea.go.kr/news'), { type: 'official', authority: 95 });
assert.equal(isOfficialDomain('https://www.bizinfo.go.kr/notice'), true);
assert.notEqual(classifySource('agent_reach_official', 'https://example.com/post').type, 'official');
assert.equal(classifySource('agent_reach_youtube', 'https://youtube.com/watch?v=1').type, 'video');
assert.ok(scoreEvidence('정부 지원사업 공고', '지원금 3억원, 2026년 조사 자료') >= 70);
assert.ok(scoreQuality(95, 80, new Date().toISOString()) > scoreQuality(25, 10, null));
assert.equal(
  eventFingerprint('AI 기업 투자 발표', '2026-07-12T01:00:00Z', 'ai_business'),
  eventFingerprint('발표, 투자 AI 기업', '2026-07-12T22:00:00Z', 'ai_business')
);
assert.ok(titleSimilarity('오픈AI GPT-6 기업용 에이전트 출시', '오픈AI, 기업용 GPT-6 에이전트 공개') >= 0.55);
assert.equal(titleSimilarity('중소기업 정책자금 접수 시작', 'AI 반도체 투자 확대'), 0);
assert.equal(dateDistanceDays('2026-07-12', '2026-07-13'), 1);
assert.equal(findMatchingCluster({
  category: 'ai_business',
  title: '오픈AI GPT-6 기업용 에이전트 출시',
  published_at: '2026-07-13T01:00:00Z',
  event_fingerprint: 'new-fingerprint',
}, [{
  id: 7,
  category: 'ai_business',
  representative_title: '오픈AI, 기업용 GPT-6 에이전트 공개',
  event_date: '2026-07-12',
  fingerprint: 'old-fingerprint',
}]).id, 7);
assert.equal(findMatchingCluster({
  category: 'ai_business',
  title: '오픈AI GPT-6 기업용 에이전트 출시',
  published_at: null,
  collected_at: '2026-07-13T05:00:00Z',
  event_fingerprint: 'new-fingerprint',
}, [{
  id: 8,
  category: 'ai_business',
  representative_title: '오픈AI, 기업용 GPT-6 에이전트 공개',
  event_date: '2026-07-13',
  fingerprint: 'old-fingerprint',
}]).id, 8);
assert.match(buildOfficialSearchQuery({ keyword: '창업 지원', category: 'policy' }), /site:korea\.kr/);
assert.match(buildRedditSearchQuery({ keyword: 'AI 에이전트', category: 'ai_business' }), /AI agent automation business/);
const facts = extractFacts({
  id: 11,
  event_cluster_id: 4,
  title: '중소벤처기업부, 2026년 지원금 3억원 공고',
  summary: '지원 대상은 120개 기업이며 "7월 31일까지 신청해야 한다"고 밝혔다.',
  canonical_url: 'https://www.mss.go.kr/notice/1',
  source_type: 'official',
});
assert.ok(facts.some((fact) => fact.fact_type === 'date' && fact.fact_text === '2026년'));
assert.ok(facts.some((fact) => fact.fact_type === 'number' && fact.fact_text.includes('3억원')));
assert.ok(facts.some((fact) => fact.fact_type === 'organization'));
assert.ok(facts.every((fact) => fact.is_official && fact.verified_at));
assert.equal(new Set(facts.map((fact) => fact.fact_text)).size, facts.length);

process.stdout.write('Research metadata tests passed.\n');
