'use strict';

const SOURCE_GRADE_RANK = { A: 4, B: 3, C: 2, D: 1 };

function gradeSource(article = {}) {
  if (article.verification_status === 'rejected') return 'D';
  const authority = Number(article.authority_score || 0);
  const quality = Number(article.quality_score || 0);
  if (article.source_type === 'official' || ['official', 'data'].includes(article.source_layer) || authority >= 85) return 'A';
  if (article.verification_status === 'verified' || authority >= 65) return 'B';
  if (['media', 'repository', 'video'].includes(article.source_type) || authority >= 40 || quality >= 50) return 'C';
  return 'D';
}

function validateBriefForPreparation(cluster = {}, articles = [], facts = [], options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const evidence = articles.filter((article) => article && article.url);
  const graded = evidence.map((article) => ({ ...article, source_grade: gradeSource(article) }));
  const usable = graded.filter((article) => article.source_grade !== 'D');
  const gradeCounts = countGrades(graded);
  const blockers = [];
  const warnings = [];
  const factTypes = new Set(facts.map((fact) => fact.fact_type));
  const independentSources = new Set(usable.map((article) => article.source_domain).filter(Boolean)).size;
  const isPolicyBrief = cluster.category === 'policy';
  const hasTitle = Boolean(cluster.representative_title?.trim());
  const hasEvidence = articles.length > 0;
  const hasSourceUrl = evidence.length > 0;
  const hasUsableSource = usable.length > 0;
  const hasOfficialSource = graded.some((article) => article.source_grade === 'A');
  const hasVerifiedSource = graded.some((article) => ['A', 'B'].includes(article.source_grade));
  const hasPolicyDate = Boolean(cluster.event_date) || evidence.some((article) => article.published_at);
  const hasKeyFacts = isPolicyBrief
    ? hasPolicyDate && (factTypes.has('date') || factTypes.has('organization') || hasOfficialSource)
    : factTypes.has('date') && factTypes.has('organization') && factTypes.has('number');
  const isFresh = isWithinHours(cluster.last_seen_at, 24, now);

  if (!hasTitle) blockers.push('대표 제목이 없어 기사 초안을 준비할 수 없습니다.');
  if (!hasEvidence) blockers.push('근거 기사가 없어 기사 초안을 준비할 수 없습니다.');
  else if (!hasSourceUrl) blockers.push('사용 가능한 근거 기사 URL이 없습니다.');
  else if (!hasUsableSource) blockers.push('사용 가능한 출처가 신뢰 등급 D뿐입니다. 원문 출처를 보강하세요.');

  if (hasUsableSource && !hasVerifiedSource) warnings.push('등급 A·B 출처가 없습니다. 독립 원문이나 검증된 발행처를 추가하세요.');
  if (isPolicyBrief && !hasOfficialSource) warnings.push('정책·지원사업은 공식 원문(등급 A)을 추가 확인하세요.');
  if (isPolicyBrief && !hasPolicyDate) warnings.push('정책·지원사업의 발행일 또는 공고일을 공식 원문에서 확인하세요.');
  if (!isPolicyBrief && independentSources < 2) warnings.push('독립 발행처가 한 곳뿐입니다. 두 번째 출처로 교차 검증하세요.');
  if (!facts.length) warnings.push('구조화된 확인 사실이 없습니다. 원문에서 날짜·기관·수치를 확인하세요.');
  else if (!hasKeyFacts) warnings.push(isPolicyBrief
    ? '정책·지원사업의 날짜·기관 사실을 보강하세요.'
    : '날짜·기관·수치 사실이 모두 확보되지 않았습니다.');
  if (!isFresh) warnings.push('최근 24시간 안에 근거가 갱신되지 않았습니다. 최신성을 다시 확인하세요.');

  const meetsReadyPolicy = isPolicyBrief
    ? hasOfficialSource && hasPolicyDate
    : hasOfficialSource || hasVerifiedSource && independentSources >= 2 || gradeCounts.C >= 2 && independentSources >= 2;
  const stage = blockers.length ? 'blocked' : meetsReadyPolicy ? 'ready' : 'reviewable';
  const canPrepare = stage !== 'blocked';
  const checklist = [
    check('title', '대표 제목', hasTitle, true, '대표 제목을 입력하세요.'),
    check('evidence', '근거 기사', hasEvidence, true, '근거 기사를 한 건 이상 연결하세요.'),
    check('source_url', '원문 URL', hasSourceUrl, true, '열 수 있는 원문 URL을 추가하세요.'),
    check('usable_source', '사용 가능한 출처(A~C)', hasUsableSource, true, '등급 A~C 출처를 추가하세요.'),
    check('verified_source', isPolicyBrief ? '공식 원문(A)' : '검증 출처(A·B)', isPolicyBrief ? hasOfficialSource : hasVerifiedSource, false, '상위 등급 출처로 보강하세요.'),
    check('independent_sources', '독립 발행처 2곳', independentSources >= 2, false, '다른 발행처의 원문을 추가하세요.'),
    check('key_facts', isPolicyBrief ? '공고일·기관 사실' : '날짜·기관·수치 사실', hasKeyFacts, false, '원문에서 구조화 사실을 보강하세요.'),
    check('fresh', '최근 24시간 갱신', isFresh, false, '최신 원문을 다시 수집하세요.'),
  ];

  return {
    stage,
    ready: stage === 'ready',
    can_prepare: canPrepare,
    review_required: stage === 'reviewable',
    checked_at: now.toISOString(),
    is_policy: isPolicyBrief,
    blockers,
    warnings,
    source_grades: gradeCounts,
    independent_source_count: independentSources,
    checklist,
    checks: {
      title: hasTitle,
      evidence: hasEvidence,
      source_url: hasSourceUrl,
      usable_source: hasUsableSource,
      verified_source: isPolicyBrief ? hasOfficialSource : hasVerifiedSource,
      independent_sources: independentSources >= 2,
      key_facts: hasKeyFacts,
      fresh: isFresh,
    },
  };
}

function check(key, label, passed, critical, guidance) {
  return { key, label, status: passed ? 'pass' : critical ? 'block' : 'warn', guidance: passed ? null : guidance };
}

function countGrades(articles) {
  return articles.reduce((counts, article) => {
    counts[article.source_grade || gradeSource(article)] += 1;
    return counts;
  }, { A: 0, B: 0, C: 0, D: 0 });
}

function sourceGradeRank(article) {
  return SOURCE_GRADE_RANK[article.source_grade || gradeSource(article)] || 0;
}

function isWithinHours(value, hours, now = new Date()) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) && now.getTime() - timestamp <= hours * 3600000;
}

module.exports = {
  SOURCE_GRADE_RANK,
  gradeSource,
  sourceGradeRank,
  validateBriefForPreparation,
};
