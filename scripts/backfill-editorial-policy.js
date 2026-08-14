#!/usr/bin/env node
'use strict';

const { gradeSource, validateBriefForPreparation } = require('../lib/editorialPolicy');

const applyChanges = process.argv.includes('--apply');
const daysArg = process.argv.find((arg) => arg.startsWith('--days='));
const days = Math.max(1, Math.min(90, Number(daysArg?.split('=')[1] || 30)));

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}

async function main() {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const recentArticles = await fetchAll('raw_articles', {
    select: 'id,event_cluster_id,url,published_at,collected_at,source_domain,source_type,source_layer,authority_score,quality_score,verification_status',
    collected_at: `gte.${since}`,
  });
  const recentClusters = await fetchAll('event_clusters', {
    select: 'id,category,representative_title,event_date,last_seen_at,official_source_count',
    last_seen_at: `gte.${since}`,
  });
  const clusterIds = recentClusters.map((cluster) => cluster.id);
  const [clusterArticles, facts] = await Promise.all([
    fetchByClusterIds('raw_articles', 'id,event_cluster_id,url,published_at,collected_at,source_domain,source_type,source_layer,authority_score,quality_score,verification_status', clusterIds),
    fetchByClusterIds('article_facts', 'event_cluster_id,fact_type,is_official', clusterIds),
  ]);

  const grades = { A: 0, B: 0, C: 0, D: 0 };
  const gradeUpdates = new Map();
  for (const article of recentArticles) {
    const grade = gradeSource(article);
    grades[grade] += 1;
    if (!gradeUpdates.has(grade)) gradeUpdates.set(grade, []);
    gradeUpdates.get(grade).push(article.id);
  }

  const stages = { blocked: 0, reviewable: 0, ready: 0 };
  const evaluations = recentClusters.map((cluster) => {
    const validation = validateBriefForPreparation(
      cluster,
      clusterArticles.filter((article) => article.event_cluster_id === cluster.id),
      facts.filter((fact) => fact.event_cluster_id === cluster.id)
    );
    stages[validation.stage] += 1;
    return { cluster, validation };
  });

  if (applyChanges) {
    for (const [grade, ids] of gradeUpdates) {
      for (const chunk of chunks(ids, 100)) {
        await request(`raw_articles?id=in.(${chunk.join(',')})`, { method: 'PATCH', body: { source_grade: grade } });
      }
    }
    for (const { cluster, validation } of evaluations) {
      await request(`event_clusters?id=eq.${cluster.id}`, {
        method: 'PATCH',
        body: {
          validation_stage: validation.stage,
          validation_checked_at: validation.checked_at,
          validation_snapshot: validation,
        },
      });
    }
  }

  console.log(JSON.stringify({
    ok: true,
    mode: applyChanges ? 'apply' : 'dry-run',
    days,
    articles_evaluated: recentArticles.length,
    clusters_evaluated: recentClusters.length,
    source_grades: grades,
    validation_stages: stages,
    next: applyChanges ? null : 'Review the counts, apply the migration, then rerun with --apply.',
  }, null, 2));
}

async function fetchByClusterIds(table, select, ids) {
  const rows = [];
  for (const chunk of chunks(ids, 100)) {
    rows.push(...await fetchAll(table, { select, event_cluster_id: `in.(${chunk.join(',')})` }));
  }
  return rows;
}

async function fetchAll(table, query) {
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const page = await request(`${table}?${new URLSearchParams(query)}`, {
      headers: { Range: `${offset}-${offset + pageSize - 1}` },
    });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function request(path, options = {}) {
  const url = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
  const key = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: options.method === 'PATCH' ? 'return=minimal' : 'count=none',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${await response.text()}`);
  if (response.status === 204) return [];
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

function chunks(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

module.exports = { chunks, fetchAll };
