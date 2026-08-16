'use strict';

const SOURCE_GRADE_RANK = { A: 4, B: 3, C: 2, D: 1 };
const NEWS_FRESH_DAYS = 7;
const NEWS_STALE_DAYS = 30;
const POLICY_FRESH_DAYS = 14;

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
  const recency = evaluateRecency(cluster, evidence, now);

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
  if (recency.warning) warnings.push(recency.warning);

  const meetsReadyPolicy = recency.ok && (isPolicyBrief
    ? hasOfficialSource && hasPolicyDate
    : hasOfficialSource || hasVerifiedSource && independentSources >= 2 || gradeCounts.C >= 2 && independentSources >= 2);
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
    check('fresh', recency.label, recency.ok, false, recency.warning || '발행일 또는 공고일을 원문에서 확인하세요.'),
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
    recency,
    checklist,
    checks: {
      title: hasTitle,
      evidence: hasEvidence,
      source_url: hasSourceUrl,
      usable_source: hasUsableSource,
      verified_source: isPolicyBrief ? hasOfficialSource : hasVerifiedSource,
      independent_sources: independentSources >= 2,
      key_facts: hasKeyFacts,
      fresh: recency.ok,
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

function parseTime(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : null;
}

function evidenceTimestamp(cluster = {}, articles = [], preferEventDate = false) {
  if (preferEventDate) {
    const eventTime = parseTime(cluster.event_date);
    if (eventTime) return eventTime;
  }
  const times = (articles || []).map((article) => parseTime(article.published_at)).filter(Boolean);
  const eventTime = parseTime(cluster.event_date);
  if (eventTime) times.push(eventTime);
  if (!times.length) return null;
  return Math.max(...times);
}

function evaluateRecency(cluster = {}, articles = [], now = new Date()) {
  const isPolicy = cluster.category === 'policy';
  const timestamp = evidenceTimestamp(cluster, articles, isPolicy);
  const label = isPolicy ? '공고일·유효 기간' : '발행일 7일 이내';
  if (timestamp == null) {
    return {
      ok: false,
      kind: 'missing',
      label,
      warning: isPolicy
        ? '공고일·발행일이 없어 유효 기간을 확인할 수 없습니다.'
        : '발행일이 없어 최근 7일 소재인지 확인할 수 없습니다.',
    };
  }
  const ageDays = (now.getTime() - timestamp) / 86400000;
  if (ageDays < 0) {
    return { ok: true, kind: 'upcoming', label, warning: null };
  }
  if (isPolicy) {
    if (ageDays <= POLICY_FRESH_DAYS) return { ok: true, kind: 'fresh', label, warning: null };
    return {
      ok: false,
      kind: 'old',
      label,
      warning: '공고·발행이 14일을 지났습니다. 접수 유효 여부를 원문에서 확인하세요.',
    };
  }
  if (ageDays <= NEWS_FRESH_DAYS) return { ok: true, kind: 'fresh', label, warning: null };
  if (ageDays <= NEWS_STALE_DAYS) {
    return {
      ok: false,
      kind: 'aging',
      label,
      warning: '발행일이 7일을 지났습니다. 시의성을 확인하세요.',
    };
  }
  return {
    ok: false,
    kind: 'stale',
    label,
    warning: '발행일이 30일을 지났습니다. 지난 뉴스로 보고 가능에서 제외합니다.',
  };
}

module.exports = {
  NEWS_FRESH_DAYS,
  NEWS_STALE_DAYS,
  POLICY_FRESH_DAYS,
  SOURCE_GRADE_RANK,
  evaluateRecency,
  gradeSource,
  sourceGradeRank,
  validateBriefForPreparation,
};
