'use strict';

const { cleanText, normalizeTitle, titleSimilarity } = require('./freeCollection');
const { gradeSource, validateBriefForPreparation } = require('./editorialPolicy');

const CATEGORY_LABELS = {
  ai_business: 'AI 비즈니스',
  startup: '창업·부업',
  policy: '정책·지원사업',
  small_business_economy: '소상공인 경제',
  local_commerce: '지역 상권',
  marketing_distribution: '마케팅·유통',
  field_issue: '현장 이슈',
};

const FACT_LABELS = {
  organization: '기관',
  date: '일정',
  number: '수치',
  quote: '인용',
  person: '인물',
  location: '장소',
  claim: '주장',
};

const WEAK_NUMBER = /^(?:\d{1,3}(?:,\d{3})*|\d+)(?:배|년|개|건|명|일|개월|% )?$/;

function stripOutlet(title) {
  return cleanText(title)
    .replace(/\s*[-–—|:]\s*[가-힣A-Za-z0-9.·&() ]{1,24}$/u, '')
    .replace(/\s*\[[^\]]{1,24}\]\s*$/u, '')
    .trim();
}

function extraLabel(text, extraCount) {
  const label = stripOutlet(text) || text || '제목 없음';
  return extraCount > 0 ? `${label} 외 ${extraCount}건` : label;
}

function isUsefulFact(fact) {
  const text = cleanText(fact?.fact_text || '');
  if (text.length < 4) return false;
  if (fact.fact_type === 'number' && WEAK_NUMBER.test(text.replace(/\s+/g, ''))) return false;
  if (fact.fact_type === 'quote' && text.length < 16) return false;
  if (fact.fact_type === 'date' && text.length < 5) return false;
  return true;
}

function compactKey(value) {
  return normalizeTitle(value).replace(/\s+/g, '');
}

function collapseSimilar(items, getText, threshold = 0.62) {
  const groups = [];
  for (const item of items || []) {
    const text = getText(item);
    const normalized = compactKey(text);
    const match = groups.find((group) => {
      const existing = getText(group.items[0]);
      const existingKey = compactKey(existing);
      const shared = existingKey.length >= 5 && normalized.length >= 5
        && (existingKey.includes(normalized) || normalized.includes(existingKey));
      return existingKey === normalized
        || shared
        || (normalized.length > 8 && titleSimilarity(existing, text) >= threshold);
    });
    if (match) match.items.push(item);
    else groups.push({ items: [item] });
  }
  return groups;
}

function collapseFacts(facts) {
  const useful = (facts || []).filter(isUsefulFact);
  return collapseSimilar(useful, (fact) => fact.fact_text, 0.78).map((group) => {
    const longest = [...group.items].sort((left, right) => (
      cleanText(right.fact_text || '').length - cleanText(left.fact_text || '').length
    ))[0];
    const official = group.items.find((item) => item.is_official);
    const chosen = official && cleanText(official.fact_text || '').length >= cleanText(longest.fact_text || '').length * 0.7
      ? official
      : longest;
    const extra = group.items.length - 1;
    return {
      ...chosen,
      fact_text: chosen.fact_text,
      extra_count: extra,
      label: extraLabel(chosen.fact_text, extra),
    };
  });
}

function collapseSources(articles) {
  return collapseSimilar(articles || [], (article) => article.title || article.url || '', 0.6).map((group) => {
    const ranked = [...group.items].sort((left, right) => {
      const grade = { A: 4, B: 3, C: 2, D: 1 };
      const leftGrade = grade[left.source_grade || gradeSource(left)] || 0;
      const rightGrade = grade[right.source_grade || gradeSource(right)] || 0;
      if (rightGrade !== leftGrade) return rightGrade - leftGrade;
      return Number(right.quality_score || 0) - Number(left.quality_score || 0);
    });
    const primary = ranked[0];
    const extra = group.items.length - 1;
    const domains = [...new Set(group.items.map((item) => item.source_domain).filter(Boolean))];
    return {
      ...primary,
      extra_count: extra,
      label: extraLabel(primary.title || primary.source_domain || primary.url, extra),
      domains,
    };
  });
}

function takeSentences(text, maxChars) {
  const cleaned = cleanText(text);
  if (!cleaned) return '';
  if (cleaned.length <= maxChars) return cleaned;
  const cut = cleaned.slice(0, maxChars);
  const bounds = ['다.', '요.', '.', '다 '].map((mark) => cut.lastIndexOf(mark));
  const index = Math.max(...bounds);
  return (index > Math.min(160, maxChars / 3) ? cut.slice(0, index + (cut[index] === '.' ? 1 : 2)) : cut).trim();
}

function uniqueSummaries(articles) {
  const selected = [];
  for (const article of articles || []) {
    const text = cleanText(article.summary || '');
    if (text.length < 40) continue;
    const overlap = selected.some((item) => (
      normalizeTitle(item.text.slice(0, 90)) === normalizeTitle(text.slice(0, 90))
      || titleSimilarity(item.text.slice(0, 80), text.slice(0, 80)) >= 0.68
    ));
    if (overlap) continue;
    selected.push({ text, article });
    if (selected.length >= 3) break;
  }
  return selected;
}

function pickFacts(facts, type, limit) {
  return collapseFacts(facts).filter((fact) => fact.fact_type === type).slice(0, limit);
}

function alreadyMentioned(haystack, value) {
  const needle = cleanText(value);
  return Boolean(needle) && haystack.includes(needle);
}

function buildSummary(cluster, articles, facts) {
  const title = stripOutlet(cluster.representative_title || articles[0]?.title || '');
  const category = CATEGORY_LABELS[cluster.category] || cluster.category || '수집 소재';
  const summaries = uniqueSummaries(articles);
  const parts = [];

  if (summaries[0]) {
    parts.push(takeSentences(summaries[0].text, 620));
  } else if (title) {
    parts.push(`${category} 소재로, ${title} 내용이 수집됐다.`);
    const otherTitles = collapseSources(articles)
      .map((item) => stripOutlet(item.title || ''))
      .filter((item) => item && item !== title)
      .slice(0, 3);
    if (otherTitles.length) parts.push(`함께 묶인 보도는 ${otherTitles.join(', ')}이다.`);
  }

  if (summaries[1]) {
    const extra = takeSentences(summaries[1].text, 280);
    if (extra && !alreadyMentioned(parts.join(' '), extra.slice(0, 24))) {
      parts.push(`다른 근거에서는 ${extra}`);
    }
  }

  const joined = parts.join(' ');
  const orgs = pickFacts(facts, 'organization', 3).map((item) => item.fact_text);
  const dates = pickFacts(facts, 'date', 3).map((item) => item.fact_text);
  const numbers = pickFacts(facts, 'number', 4).map((item) => item.fact_text);
  const missing = [];
  const unusedOrgs = orgs.filter((item) => !alreadyMentioned(joined, item));
  const unusedDates = dates.filter((item) => !alreadyMentioned(joined, item));
  const unusedNumbers = numbers.filter((item) => !alreadyMentioned(joined, item));
  if (unusedOrgs.length) missing.push(`관련 기관은 ${unusedOrgs.join(', ')}이다.`);
  if (unusedDates.length) missing.push(`확인된 시점은 ${unusedDates.join(', ')}이다.`);
  if (unusedNumbers.length) missing.push(`확인된 수치는 ${unusedNumbers.join(', ')}이다.`);
  if (missing.length) parts.push(missing.join(' '));

  if (summaries[2]) {
    const third = takeSentences(summaries[2].text, 220);
    if (third && !alreadyMentioned(parts.join(' '), third.slice(0, 24))) parts.push(third);
  }

  const sources = collapseSources(articles);
  if (sources.length) {
    const top = sources[0];
    const more = sources.length - 1;
    const sourceLine = more > 0
      ? `근거는 ${top.label} 등 ${sources.length}개 묶음이다.`
      : `근거는 ${top.label}이다.`;
    if (!alreadyMentioned(parts.join(' '), top.label.slice(0, 18))) parts.push(sourceLine);
  }

  const summary = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return summary.slice(0, 1600);
}

function hasReadableSummary(articles) {
  return uniqueSummaries(articles).length > 0;
}

function previewSummary(summary) {
  return takeSentences(summary, 200);
}

function decisionFromValidation(validation, articles = []) {
  if (validation.stage === 'ready') {
    const readable = hasReadableSummary(articles);
    return {
      allowed: true,
      needs_source_read: !readable,
      label: readable ? '작성 가능' : '작성 가능 · 원문 확인',
      reason: readable
        ? '제목·원문·사용 가능한 출처가 확인되어 바로 초안으로 넘길 수 있습니다. 미검토 단계는 없습니다.'
        : '출처 조건은 통과했지만 원문 설명이 부족합니다. 근거 원문을 한 건 확인하세요.',
    };
  }
  if (validation.stage === 'reviewable') {
    return {
      allowed: false,
      needs_source_read: true,
      label: '작성 보류',
      reason: validation.warnings[0] || '경고 항목을 원문에서 확인한 뒤 초안을 준비할 수 있습니다.',
    };
  }
  return {
    allowed: false,
    needs_source_read: true,
    label: '작성 불가',
    reason: validation.blockers[0] || '필수 검증을 통과해야 초안을 준비할 수 있습니다.',
  };
}

function highlightRows(facts, articles) {
  const rows = [];
  const add = (key, values) => {
    if (!values.length) return;
    rows.push({
      key,
      label: FACT_LABELS[key] || key,
      value: extraLabel(values[0].fact_text || values[0].label, values.length - 1),
      extra_count: Math.max(0, values.length - 1),
      official: values.some((item) => item.is_official),
    });
  };
  add('organization', pickFacts(facts, 'organization', 4));
  add('date', pickFacts(facts, 'date', 4));
  add('number', pickFacts(facts, 'number', 4));
  const sources = collapseSources(articles);
  if (sources.length) {
    const grades = (articles || []).reduce((counts, item) => {
      const grade = item.source_grade || gradeSource(item);
      counts[grade] = (counts[grade] || 0) + 1;
      return counts;
    }, {});
    const gradeText = ['A', 'B', 'C', 'D'].filter((grade) => grades[grade]).map((grade) => `${grade} ${grades[grade]}`).join(' · ');
    const extra = Math.max(0, (articles || []).length - 1);
    rows.push({
      key: 'source',
      label: '출처',
      value: extraLabel(sources[0].title || sources[0].source_domain || sources[0].url, extra),
      extra_count: extra,
      official: sources.some((item) => (item.source_grade || gradeSource(item)) === 'A'),
      detail: gradeText,
    });
  }
  return rows;
}

function buildBriefDigest(cluster = {}, articles = [], facts = [], validation = null) {
  const policy = validation || validateBriefForPreparation(cluster, articles, facts);
  const sorted = [...articles];
  const collapsedFacts = collapseFacts(facts);
  const sources = collapseSources(sorted);
  const title = stripOutlet(cluster.representative_title || sorted[0]?.title || '제목 없음');
  const summary = buildSummary({ ...cluster, representative_title: title }, sorted, facts);
  return {
    title,
    category_label: CATEGORY_LABELS[cluster.category] || cluster.category || '',
    decision: decisionFromValidation(policy, sorted),
    summary,
    preview: previewSummary(summary),
    highlights: highlightRows(facts, sorted),
    sources,
    fact_groups: collapsedFacts,
    source_count: sorted.length,
    source_group_count: sources.length,
  };
}

module.exports = {
  buildBriefDigest,
  collapseFacts,
  collapseSources,
  extraLabel,
  stripOutlet,
};
