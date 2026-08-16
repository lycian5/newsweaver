'use strict';

const { createHash } = require('node:crypto');
const { buildBriefDigest } = require('./briefDigest');
const { buildEvidence } = require('./editorialAi');
const { generateBriefSummaryReview, resolveEditorialAiRoute, aiEnabled } = require('./editorialAiProvider');
const { validateBriefForPreparation } = require('./editorialPolicy');

function summaryHash(text) {
  return createHash('sha256').update(String(text || '')).digest('hex');
}

function storedReview(snapshot) {
  return snapshot && typeof snapshot === 'object' ? snapshot.ai_summary_review || null : null;
}

function reviewMatchesSummary(review, summary) {
  return Boolean(review && review.summary_hash && review.summary_hash === summaryHash(summary));
}

function attachStoredReview(cluster, digest) {
  const review = storedReview(cluster?.validation_snapshot);
  if (!reviewMatchesSummary(review, digest?.summary)) return null;
  return review;
}

async function reviewUpdatedBriefs({ since, limit, request } = {}) {
  if (!aiEnabled()) return { skipped: true, reason: 'disabled', reviewed: 0, reused: 0, failed: 0 };
  let route;
  try {
    route = resolveEditorialAiRoute({ tier: 'basic' });
  } catch (err) {
    return { skipped: true, reason: err.message, reviewed: 0, reused: 0, failed: 0 };
  }

  const max = Math.min(Math.max(Number(limit || process.env.AGENT_REACH_BRIEF_REVIEW_LIMIT || 80), 1), 120);
  const qs = new URLSearchParams({
    select: 'id,category,representative_title,event_date,last_seen_at,status,editorial_state,validation_snapshot',
    status: 'neq.archived',
    order: 'last_seen_at.desc',
    limit: String(max),
  });
  if (since) qs.set('last_seen_at', `gte.${since}`);
  const clusters = await request(`/rest/v1/event_clusters?${qs.toString()}`);
  const stats = { skipped: false, reason: null, reviewed: 0, reused: 0, failed: 0, candidates: (clusters || []).length };

  for (const cluster of clusters || []) {
    try {
      const result = await reviewOneBrief(cluster, route, request);
      if (result === 'reused') stats.reused += 1;
      else if (result === 'reviewed') stats.reviewed += 1;
    } catch (err) {
      stats.failed += 1;
      console.error(`[brief-review] cluster ${cluster.id}: ${err.message}`);
    }
  }
  return stats;
}

async function reviewOneBrief(cluster, route, request) {
  const articles = await request(`/rest/v1/raw_articles?event_cluster_id=eq.${cluster.id}&select=title,url,summary,published_at,source_domain,source,source_type,source_layer,authority_score,quality_score,verification_status&order=quality_score.desc&limit=40`);
  const facts = await request(`/rest/v1/article_facts?event_cluster_id=eq.${cluster.id}&select=fact_text,fact_type,source_url,is_official,confidence&order=confidence.desc&limit=40`);
  const validation = validateBriefForPreparation(cluster, articles || [], facts || []);
  if (validation.stage === 'blocked') return 'skipped';
  const digest = buildBriefDigest(cluster, articles || [], facts || [], validation);
  if (!digest.summary) return 'skipped';
  if (reviewMatchesSummary(storedReview(cluster.validation_snapshot), digest.summary)) return 'reused';

  const context = buildEvidence(cluster, articles || [], facts || []);
  const { review } = await generateBriefSummaryReview(route, { digest, context });
  const payload = {
    ...review,
    summary_hash: summaryHash(digest.summary),
    reviewed_at: new Date().toISOString(),
    model: route.model,
    provider: route.provider,
  };
  const snapshot = cluster.validation_snapshot && typeof cluster.validation_snapshot === 'object'
    ? { ...cluster.validation_snapshot, ai_summary_review: payload }
    : { ai_summary_review: payload };
  await request(`/rest/v1/event_clusters?id=eq.${cluster.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ validation_snapshot: snapshot }),
  });
  cluster.validation_snapshot = snapshot;
  return 'reviewed';
}

module.exports = {
  attachStoredReview,
  reviewMatchesSummary,
  reviewUpdatedBriefs,
  storedReview,
  summaryHash,
};
