'use strict';

const { createHash } = require('node:crypto');
const { gradeSource } = require('./editorialPolicy');

const VALID_CATEGORIES = new Set([
  'ai_business',
  'startup',
  'policy',
  'small_business_economy',
  'local_commerce',
  'marketing_distribution',
  'field_issue',
]);

const TRACKING_QUERY_KEYS = /^(utm_.+|fbclid|gclid|ref|source|campaign)$/i;
const TITLE_STOP_WORDS = new Set([
  '관련', '대한', '위한', '통해', '뉴스', '속보', '단독', '발표', '공개', '밝혀',
]);

function cleanText(value) {
  return decodeXml(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function normalizeUrl(value) {
  const text = String(value || '').trim();
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_QUERY_KEYS.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    url.searchParams.sort();
    return url.toString();
  } catch {
    return '';
  }
}

function hostName(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function isOfficialDomain(url) {
  const domain = hostName(url);
  return /\.go\.kr$|\.gov$|\.gov\.kr$|korea\.kr$|kosis\.kr$|data\.go\.kr$|bok\.or\.kr$|dart\.fss\.or\.kr$|nipa\.kr$|kisa\.or\.kr$|semas\.or\.kr$|bizinfo\.go\.kr$|k-startup\.go\.kr$/.test(domain);
}

function classifySource(source, url) {
  const domain = hostName(url);
  if (isOfficialDomain(url)) return { type: 'official', authority: /\.go\.kr$|\.gov(?:\.kr)?$/.test(domain) ? 95 : 90 };
  if (/youtube/i.test(source) || /youtube\.com|youtu\.be/.test(domain)) return { type: 'video', authority: 35 };
  if (/github/i.test(source) || domain === 'github.com') return { type: 'repository', authority: 45 };
  if (/reddit|community|cafe|blog/i.test(source) || /reddit\.com|blog\.naver\.com/.test(domain)) return { type: 'community', authority: 25 };
  if (/newsroom|press_release/i.test(source)) return { type: 'official', authority: 85 };
  if (/rss|exa|naver_news|google_news|bing_news|korean_news/i.test(source)) return { type: 'media', authority: 55 };
  return { type: 'unknown', authority: 40 };
}

function scoreEvidence(title, summary) {
  const text = `${title || ''} ${summary || ''}`;
  let score = 10;
  if (/\d/.test(text)) score += 20;
  if (/\d+(?:\.\d+)?\s*(?:%|원|억원|조원|명|건|개|배|년|월|일)/.test(text)) score += 25;
  if (/발표|공고|통계|조사|보고서|자료|공시/.test(text)) score += 20;
  if ((summary || '').length >= 250) score += 15;
  return Math.min(100, score);
}

function scoreQuality(authority, evidence, publishedAt, now = Date.now()) {
  const publishedTime = publishedAt ? new Date(publishedAt).getTime() : Number.NaN;
  const freshness = Number.isFinite(publishedTime) && now - publishedTime <= 7 * 86400000 ? 20 : 10;
  return Math.min(100, Math.round(authority * 0.45 + evidence * 0.35 + freshness));
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeTitle(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^0-9a-z가-힣\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function eventDate(value) {
  const iso = toIsoOrNull(value);
  return iso ? iso.slice(0, 10) : null;
}

function eventFingerprint(title, publishedAt, category) {
  const dateBucket = eventDate(publishedAt) || 'undated';
  const tokens = [...titleTokens(title)].slice(0, 12).sort().join(' ');
  return hash(`${category}|${dateBucket}|${tokens}`);
}

function normalizeArticle(raw, options = {}) {
  const canonicalUrl = normalizeUrl(raw.canonical_url || raw.url);
  const title = cleanText(raw.title || '').slice(0, 500);
  if (!canonicalUrl) return { row: null, reason: 'invalid_url' };
  if (title.length < 3) return { row: null, reason: 'invalid_title' };

  const category = VALID_CATEGORIES.has(raw.category) ? raw.category : 'ai_business';
  const source = String(raw.source || 'collector').slice(0, 120);
  const summary = raw.summary ? cleanText(raw.summary).slice(0, 1200) : null;
  const publishedAt = toIsoOrNull(raw.published_at);
  const normalizedTitle = normalizeTitle(title);
  const sourceProfile = classifySource(source, canonicalUrl);
  const publisherDomain = hostName(raw.publisher_url || raw.publisher_domain || '') || hostName(canonicalUrl);
  const evidenceScore = scoreEvidence(title, summary);
  const now = options.now || new Date().toISOString();

  const qualityScore = scoreQuality(sourceProfile.authority, evidenceScore, publishedAt, Date.parse(now));
  const sourceGrade = gradeSource({
    source_type: sourceProfile.type,
    source_layer: raw.source_layer || (sourceProfile.type === 'official' ? 'official' : 'signal'),
    authority_score: sourceProfile.authority,
    quality_score: qualityScore,
    verification_status: sourceProfile.type === 'official' ? 'verified' : 'needs_verification',
  });

  return {
    reason: null,
    row: {
      keyword_id: raw.keyword_id || null,
      category,
      source,
      title,
      url: canonicalUrl,
      summary,
      published_at: publishedAt,
      canonical_url: canonicalUrl,
      normalized_title: normalizedTitle,
      url_hash: hash(canonicalUrl),
      title_hash: hash(normalizedTitle),
      content_fingerprint: hash(`${normalizedTitle}\n${cleanText(summary || '').slice(0, 4000)}`),
      source_domain: publisherDomain,
      discovery_channel: String(raw.discovery_channel || source).slice(0, 120),
      publisher_name: cleanText(raw.publisher_name || '').slice(0, 200) || null,
      source_type: sourceProfile.type,
      authority_score: sourceProfile.authority,
      evidence_score: evidenceScore,
      quality_score: qualityScore,
      verification_status: sourceProfile.type === 'official' ? 'verified' : 'needs_verification',
      source_grade: sourceGrade,
      query_stage: raw.query_stage || 'explore',
      source_layer: raw.source_layer || (sourceProfile.type === 'official' ? 'official' : 'signal'),
      event_fingerprint: eventFingerprint(title, publishedAt || raw.collected_at || now, category),
      last_checked_at: now,
    },
  };
}

function normalizeAndDedupe(rows, options = {}) {
  const unique = [];
  const seenUrls = new Set();
  const seenTitles = new Set();
  const rejectionCounts = { invalid_url: 0, invalid_title: 0, duplicate_url: 0, duplicate_title: 0 };

  for (const raw of rows || []) {
    const normalized = normalizeArticle(raw, options);
    if (!normalized.row) {
      rejectionCounts[normalized.reason] += 1;
      continue;
    }
    const row = normalized.row;
    if (seenUrls.has(row.url_hash)) {
      rejectionCounts.duplicate_url += 1;
      continue;
    }
    const publishedDate = eventDate(row.published_at);
    const titleKey = publishedDate ? `${row.category}|${publishedDate}|${row.title_hash}` : null;
    if (titleKey && seenTitles.has(titleKey)) {
      rejectionCounts.duplicate_title += 1;
      continue;
    }
    seenUrls.add(row.url_hash);
    if (titleKey) seenTitles.add(titleKey);
    unique.push(row);
  }

  return {
    rows: unique,
    funnel: {
      discovered: (rows || []).length,
      normalized: unique.length + rejectionCounts.duplicate_url + rejectionCounts.duplicate_title,
      unique: unique.length,
      rejected: Object.values(rejectionCounts).reduce((sum, count) => sum + count, 0),
      rejection_counts: rejectionCounts,
    },
  };
}

function titleTokens(value) {
  return new Set(normalizeTitle(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !TITLE_STOP_WORDS.has(token)));
}

function titleSimilarity(left, right) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (leftTokens.size < 2 || rightTokens.size < 2) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  if (intersection < 2) return 0;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const containment = intersection / Math.min(leftTokens.size, rightTokens.size);
  const jaccard = intersection / union;
  return Number((containment * 0.7 + jaccard * 0.3).toFixed(4));
}

function dateDistanceDays(left, right) {
  const leftTime = Date.parse(`${left}T00:00:00Z`);
  const rightTime = Date.parse(`${right}T00:00:00Z`);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return Number.POSITIVE_INFINITY;
  return Math.abs(leftTime - rightTime) / 86400000;
}

function findClusterMatch(row, clusters, options = {}) {
  const exact = (clusters || []).find((cluster) => cluster.fingerprint === row.event_fingerprint);
  if (exact) return { cluster: exact, method: 'fingerprint', score: 1 };

  const rowDate = eventDate(row.published_at || row.collected_at);
  if (!rowDate) return null;
  const threshold = Number(options.similarityThreshold || 0.55);
  let best = null;
  for (const cluster of clusters || []) {
    if (cluster.category !== row.category || !cluster.event_date) continue;
    const distance = dateDistanceDays(rowDate, cluster.event_date);
    if (distance > 1) continue;
    const similarity = titleSimilarity(row.title, cluster.representative_title);
    const score = similarity * (distance === 0 ? 1 : 0.92);
    if (score >= threshold && (!best || score > best.score)) {
      best = { cluster, method: 'title_date', score: Number(score.toFixed(4)) };
    }
  }
  return best;
}

function findMatchingCluster(row, clusters, options) {
  return findClusterMatch(row, clusters, options)?.cluster || null;
}

module.exports = {
  cleanText,
  classifySource,
  dateDistanceDays,
  eventDate,
  eventFingerprint,
  findClusterMatch,
  findMatchingCluster,
  hostName,
  isOfficialDomain,
  normalizeAndDedupe,
  normalizeArticle,
  normalizeTitle,
  normalizeUrl,
  scoreEvidence,
  scoreQuality,
  titleSimilarity,
  toIsoOrNull,
};
