'use strict';

const CATEGORIES = Object.freeze({
  ai_business: { label: 'AI 비즈니스', context: 'AI 업무 자동화 기업 활용' },
  startup: { label: '창업·부업', context: '창업 자영업 수익화 국내' },
  policy: { label: '정책·지원사업', context: '정부 지원사업 중소기업 소상공인' },
  small_business_economy: { label: '소상공인 경제', context: '소상공인 자영업 매출 비용 경영' },
  local_commerce: { label: '지역 상권', context: '지역 상권 전통시장 골목상권 매출' },
  marketing_distribution: { label: '마케팅·유통', context: '소상공인 마케팅 유통 플랫폼 소비자' },
  field_issue: { label: '현장 이슈', context: '점주 자영업 현장 사례 분쟁' },
});

const KEYWORD_AXES = Object.freeze({
  subject: ['소상공인', '자영업자', '개인사업자', '점주', '가맹점주'],
  industry: ['외식업', '카페', '편의점', '미용업', '전통시장', '프랜차이즈'],
  issue: ['매출', '임대료', '수수료', '배달비', '원재료비', '대출', '지원금', '세금', '규제', '폐업'],
  context: ['서울', '경기', '지역 상권', '공정거래위원회', '중소벤처기업부', '2026'],
});

const SYNONYM_GROUPS = Object.freeze([
  ['소상공인', '자영업자', '개인사업자'],
  ['프랜차이즈', '가맹사업', '가맹점'],
  ['배달앱', '배달 플랫폼', '온라인 플랫폼'],
  ['폐업', '사업 정리', '재기', '재창업'],
  ['지원금', '지원사업', '정책자금', '보조금'],
]);

const OFFICIAL_DOMAINS = Object.freeze({
  ai_business: ['msit.go.kr', 'nipa.kr', 'kisa.or.kr', 'korea.kr', 'moef.go.kr'],
  startup: ['mss.go.kr', 'k-startup.go.kr', 'semas.or.kr', 'bizinfo.go.kr', 'korea.kr'],
  policy: ['korea.kr', 'mss.go.kr', 'moel.go.kr', 'bizinfo.go.kr', 'ftc.go.kr', 'moef.go.kr'],
  small_business_economy: ['mss.go.kr', 'semas.or.kr', 'kosis.kr', 'bok.or.kr', 'moef.go.kr', 'kostat.go.kr'],
  local_commerce: ['semas.or.kr', 'data.go.kr', 'kosis.kr', 'localdata.go.kr', 'ftc.go.kr'],
  marketing_distribution: ['ftc.go.kr', 'kca.go.kr', 'mss.go.kr', 'data.go.kr'],
  field_issue: ['ftc.go.kr', 'scourt.go.kr', 'mss.go.kr', 'semas.or.kr'],
});

const VALID_CATEGORIES = new Set(Object.keys(CATEGORIES));

function aliasesFor(keyword) {
  const text = String(keyword || '').trim();
  const group = SYNONYM_GROUPS.find((items) => items.some((item) => text.includes(item)));
  return group ? group.filter((item) => item !== text) : [];
}

function buildSearchQuery(keyword, stage = 'precision') {
  const category = VALID_CATEGORIES.has(keyword.category) ? keyword.category : 'ai_business';
  const profile = CATEGORIES[category];
  const aliases = aliasesFor(keyword.keyword).slice(0, 2);
  if (stage === 'explore') return `${keyword.keyword} ${aliases.join(' ')} 최신`.replace(/\s+/g, ' ').trim();
  if (stage === 'verification') return buildOfficialSearchQuery(keyword);
  return `${keyword.keyword} ${aliases.join(' ')} ${profile.context} 최신`.replace(/\s+/g, ' ').trim();
}

function buildOfficialSearchQuery(keyword) {
  const category = VALID_CATEGORIES.has(keyword.category) ? keyword.category : 'ai_business';
  const domains = OFFICIAL_DOMAINS[category] || ['go.kr', 'korea.kr'];
  const siteFilter = `(${domains.map((domain) => `site:${domain}`).join(' OR ')})`;
  return `"${keyword.keyword}" ${siteFilter} (filetype:pdf OR filetype:hwp OR filetype:hwpx) 발표 공고 자료`;
}

module.exports = {
  CATEGORIES,
  KEYWORD_AXES,
  OFFICIAL_DOMAINS,
  SYNONYM_GROUPS,
  VALID_CATEGORIES,
  aliasesFor,
  buildOfficialSearchQuery,
  buildSearchQuery,
};
