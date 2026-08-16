#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname } = require('node:path');
const { selectHybridKeywords, selectCollectionKeywords } = require('./keyword-selection');
const freeCollection = require('../lib/freeCollection');
const {
  VALID_CATEGORIES,
  buildOfficialSearchQuery: buildLayeredOfficialSearchQuery,
  buildSearchQuery: buildLayeredSearchQuery,
} = require('./research-query-taxonomy');
const { DEFAULT_FEEDS: KOREAN_NEWS_FEEDS } = require('../lib/koreanNewsRss');

const DEFAULT_SOURCES = ['exa', 'official', 'rss'];
const DEFAULT_RSS_FEEDS = [
  'TechCrunch AI|https://techcrunch.com/category/artificial-intelligence/feed/|ai_business',
  'VentureBeat AI|https://venturebeat.com/category/ai/feed/|ai_business',
  'Wired AI|https://www.wired.com/feed/tag/ai/latest/rss|ai_business',
  'Ars Technica Technology Lab|https://feeds.arstechnica.com/arstechnica/technology-lab|ai_business',
  'TechCrunch Startups|https://techcrunch.com/category/startups/feed/|startup',
].join(',');
const rssFeedCache = new Map();
const jinaPageCache = new Map();
let redditAccessToken = null;

const args = parseArgs(process.argv.slice(2));
const dryRun = boolArg('dry-run', false);
const sources = splitList(args.sources || process.env.AGENT_REACH_SOURCES || DEFAULT_SOURCES.join(','));
const inlineKeywords = splitList(args.keywords || process.env.AGENT_REACH_KEYWORDS || '');
const limitKeywords = intArg('limit-keywords', process.env.AGENT_REACH_LIMIT_KEYWORDS, 54);
const coreKeywordCount = intArg('core-keywords', process.env.AGENT_REACH_CORE_KEYWORDS, 12);
const rotatingKeywordCount = intArg('rotating-keywords', process.env.AGENT_REACH_ROTATING_KEYWORDS, 42);
const exaResults = Math.min(intArg('exa-results', process.env.AGENT_REACH_EXA_RESULTS, 3), 3);
const officialResults = intArg('official-results', process.env.AGENT_REACH_OFFICIAL_RESULTS, 3);
const youtubeResults = intArg('youtube-results', process.env.AGENT_REACH_YOUTUBE_RESULTS, 3);
const githubResults = intArg('github-results', process.env.AGENT_REACH_GITHUB_RESULTS, 5);
const redditResults = intArg('reddit-results', process.env.AGENT_REACH_REDDIT_RESULTS, 5);
const timeoutMs = intArg('timeout-ms', process.env.AGENT_REACH_TIMEOUT_MS, 45000);
const jinaEnrich = boolArg('jina-enrich', parseBool(process.env.AGENT_REACH_JINA_ENRICH, false));
const exaDailyRequestLimit = intArg('exa-daily-request-limit', process.env.AGENT_REACH_EXA_DAILY_REQUEST_LIMIT, 36);
const exaMonthlyBudgetUsd = numberArg('exa-monthly-budget-usd', process.env.AGENT_REACH_EXA_MONTHLY_BUDGET_USD, 8);
const exaUsageFile = process.env.AGENT_REACH_EXA_USAGE_FILE || '/opt/n8n/data/agent-reach-exa-usage.json';
let exaUsageState = null;

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exitCode = 1;
  });
}

async function main() {
  const runStartedAt = new Date().toISOString();
  let runId = null;
  try {
    const { keywords, risingArticles } = await loadKeywords();
    const keywordSelection = selectCollectionKeywords(keywords, risingArticles, {
      limitKeywords,
      coreKeywordCount,
      rotatingKeywordCount,
      date: new Date(),
    });
    const limitedKeywords = inlineKeywords.length
      ? keywords.slice(0, limitKeywords)
      : keywordSelection.selected;
    const allRows = [];
    const failures = [];
    let factsExtracted = 0;

    if (!dryRun) {
      runId = randomUUID();
      await startCollectionRun(runId, runStartedAt, limitedKeywords.length);
    }

    for (const keyword of limitedKeywords) {
      const collectors = [
        ['exa', collectExa],
        ['official', collectOfficial],
        ['rss', collectRss],
        ['youtube', collectYoutube],
        ['github', collectGithub],
        ['reddit', collectReddit],
      ];

      for (const [name, collector] of collectors) {
        if (!sources.includes(name)) continue;
        try {
          const rows = await collector(keyword);
          allRows.push(...rows);
        } catch (err) {
          failures.push({ source: name, keyword: keyword.keyword, error: err.message });
        }
      }
    }

    const normalization = freeCollection.normalizeAndDedupe(allRows);
    const rows = normalization.rows;
    let savedRows = [];
    let clusterStats = emptyClusterStats();
    let readyBriefs = 0;
    if (!dryRun && rows.length) {
      savedRows = await upsertRawArticles(rows);
      clusterStats = mergeClusterStats(clusterStats, await assignEventClusters(savedRows));
      clusterStats = mergeClusterStats(clusterStats, await backfillUnclusteredArticles());
      failures.push(...clusterStats.failures);
      await backfillMissingClusterDates();
      factsExtracted = await upsertArticleFacts(savedRows);
      await touchKeywords(rows);
      try {
        readyBriefs = await countReadyBriefsSince(runStartedAt);
      } catch (err) {
        failures.push({ source: 'briefs', keyword: '', error: `Ready brief count failed: ${err.message}` });
      }
      try {
        const reviewStats = await reviewBriefsAfterCollection(runStartedAt);
        if (reviewStats && !reviewStats.skipped) {
          clusterStats.briefReviews = reviewStats;
        } else if (reviewStats?.reason && reviewStats.reason !== 'disabled') {
          failures.push({ source: 'brief_review', keyword: '', error: reviewStats.reason.slice(0, 500) });
        }
      } catch (err) {
        failures.push({ source: 'brief_review', keyword: '', error: `Brief summary review failed: ${err.message}` });
      }
    }

    const status = failures.length ? 'partial' : 'succeeded';
    const funnel = {
      ...normalization.funnel,
      stored: dryRun ? 0 : savedRows.length,
      clustered_articles: clusterStats.articlesAssigned,
      clusters_created: clusterStats.clustersCreated,
      clusters_updated: clusterStats.clustersUpdated,
      facts_extracted: factsExtracted,
      ready_briefs: readyBriefs,
      brief_reviews: clusterStats.briefReviews?.reviewed || 0,
    };
    const summary = {
      ok: true,
      status,
      collectionRunId: runId,
      dryRun,
      sources,
      keywordsProcessed: limitedKeywords.length,
      rowsDiscovered: allRows.length,
      rowsPrepared: rows.length,
      rowsUpserted: dryRun ? 0 : savedRows.length,
      clustersAssigned: clusterStats.articlesAssigned,
      clustersCreated: clusterStats.clustersCreated,
      clustersUpdated: clusterStats.clustersUpdated,
      readyBriefs,
      factsExtracted,
      briefReviews: clusterStats.briefReviews || null,
      funnel,
      risingKeywordsApplied: inlineKeywords.length ? 0 : keywordSelection.rising.length,
      failures,
    };
    if (runId) await finishCollectionRun(runId, summary);
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    if (runId) await failCollectionRun(runId, err).catch(() => {});
    throw err;
  }
}

function emptyClusterStats() {
  return { articlesAssigned: 0, clustersCreated: 0, clustersUpdated: 0, failures: [], briefReviews: null };
}

async function reviewBriefsAfterCollection(since) {
  const { reviewUpdatedBriefs } = require('../lib/briefSummaryReviewJob');
  return reviewUpdatedBriefs({
    since,
    request: (path, options) => supabaseRequest(`${requiredEnv('SUPABASE_URL')}${path}`, options),
  });
}

function mergeClusterStats(left, right) {
  return {
    articlesAssigned: left.articlesAssigned + right.articlesAssigned,
    clustersCreated: left.clustersCreated + right.clustersCreated,
    clustersUpdated: left.clustersUpdated + right.clustersUpdated,
    failures: [...(left.failures || []), ...(right.failures || [])],
  };
}

async function startCollectionRun(id, startedAt, keywordCount) {
  await supabaseRequest(`${requiredEnv('SUPABASE_URL')}/rest/v1/collection_runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      id,
      collector: 'agent_reach',
      trigger: dryRun ? 'dry_run' : 'runner',
      status: 'running',
      sources,
      keywords_processed: keywordCount,
      started_at: startedAt,
    }),
  });
}

async function finishCollectionRun(id, summary) {
  await supabaseRequest(`${requiredEnv('SUPABASE_URL')}/rest/v1/collection_runs?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: summary.status,
      completed_at: new Date().toISOString(),
      keywords_processed: summary.keywordsProcessed,
      discovered_count: summary.funnel.discovered,
      normalized_count: summary.funnel.normalized,
      unique_count: summary.funnel.unique,
      stored_count: summary.funnel.stored,
      clustered_article_count: summary.funnel.clustered_articles,
      clusters_created_count: summary.funnel.clusters_created,
      clusters_updated_count: summary.funnel.clusters_updated,
      ready_brief_count: summary.funnel.ready_briefs,
      fact_count: summary.funnel.facts_extracted,
      rejection_counts: summary.funnel.rejection_counts,
      source_failures: summary.failures,
    }),
  });
}

async function failCollectionRun(id, error) {
  await supabaseRequest(`${requiredEnv('SUPABASE_URL')}/rest/v1/collection_runs?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'failed',
      completed_at: new Date().toISOString(),
      source_failures: [{ source: 'pipeline', error: String(error?.message || error).slice(0, 500) }],
    }),
  });
}

async function countReadyBriefsSince(since) {
  const qs = new URLSearchParams({
    status: 'eq.ready',
    last_seen_at: `gte.${since}`,
    select: 'id',
    limit: '1000',
  });
  const rows = await supabaseRequest(`${requiredEnv('SUPABASE_URL')}/rest/v1/event_clusters?${qs.toString()}`);
  return rows.length;
}

async function loadKeywords() {
  if (inlineKeywords.length) {
    const keywords = inlineKeywords.map((entry) => {
      const [keyword, category = 'ai_business'] = entry.split(':').map((part) => part.trim());
      return normalizeKeyword({ id: null, keyword, category });
    }).filter((item) => item.keyword);
    return { keywords, risingArticles: [] };
  }

  const url = requiredEnv('SUPABASE_URL');
  const qs = new URLSearchParams({
    status: 'eq.active',
    added_by: 'eq.manual',
    select: 'id,keyword,category,datalab_priority',
    order: 'datalab_priority.asc,id.asc',
  });
  const data = await supabaseRequest(`${url}/rest/v1/tracked_keywords?${qs.toString()}`);
  let risingArticles = [];
  try {
    const articleQs = new URLSearchParams({
      select: 'keyword_id,category,collected_at,tracked_keywords(keyword)',
      category: 'in.(ai_business,startup,policy)',
      collected_at: `gte.${new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()}`,
      keyword_id: 'not.is.null',
    });
    const articles = await supabaseRequest(`${url}/rest/v1/raw_articles?${articleQs.toString()}`);
    risingArticles = (articles || []).map((article) => ({ ...article, keyword: article.tracked_keywords?.keyword }));
  } catch (err) {
    console.error(`[agent-reach] rising keyword lookup failed: ${err.message}`);
  }
  return { keywords: data.map(normalizeKeyword).filter((item) => item.keyword), risingArticles };
}

async function collectExa(keyword) {
  return collectExaQuery(keyword, buildLayeredSearchQuery(keyword, 'precision'), exaResults, 'agent_reach_exa', 'precision', 'signal');
}

async function collectOfficial(keyword) {
  return collectExaQuery(keyword, buildLayeredOfficialSearchQuery(keyword), officialResults, 'agent_reach_official', 'verification', 'official');
}

async function collectExaQuery(keyword, query, resultLimit, source, queryStage, sourceLayer) {
  if (process.env.EXA_API_KEY) {
    return collectExaApiQuery(keyword, query, resultLimit, source, queryStage, sourceLayer);
  }
  const output = await runCommand('mcporter', [
    'call',
    'exa.web_search_exa',
    '--args',
    JSON.stringify({ query, numResults: resultLimit }),
    '--output',
    'json',
    '--timeout',
    String(timeoutMs),
  ]);
  const parsed = parseJson(output.stdout);
  const content = Array.isArray(parsed?.content) ? parsed.content : [];
  const rows = [];

  for (const item of content) {
    const result = parseExaText(item.text || '');
    if (!result.url) continue;
    if (source === 'agent_reach_official' && !isOfficialDomain(result.url)) continue;
    const enriched = await maybeEnrichWithJina(result);
    rows.push(makeRow(keyword, {
      source,
      title: enriched.title || result.title,
      url: result.url,
      summary: enriched.summary || result.summary,
      published_at: result.published_at,
      query_stage: queryStage,
      source_layer: sourceLayer,
    }));
  }
  return rows;
}

async function collectExaApiQuery(keyword, query, resultLimit, source, queryStage, sourceLayer) {
  if (!reserveExaRequest()) return [];

  const res = await fetchWithTimeout('https://api.exa.ai/search', timeoutMs, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.EXA_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      category: 'news',
      numResults: Math.min(resultLimit, 3),
      contents: { highlights: true },
    }),
  });
  const payload = await res.json().catch(() => ({}));
  recordExaCost(payload?.costDollars?.total);
  if (!res.ok) {
    throw new Error(`Exa API HTTP ${res.status}: ${String(payload?.error || payload?.message || '').slice(0, 300)}`);
  }

  return (payload.results || [])
    .filter((result) => result?.url && result?.title)
    .filter((result) => source !== 'agent_reach_official' || isOfficialDomain(result.url))
    .map((result) => makeRow(keyword, {
      source,
      title: result.title,
      url: result.url,
      summary: (result.highlights || []).join(' ') || result.summary || result.text || null,
      published_at: result.publishedDate || null,
      query_stage: queryStage,
      source_layer: sourceLayer,
    }));
}

function reserveExaRequest() {
  const usage = loadExaUsage();
  if (usage.dailyRequests >= exaDailyRequestLimit || usage.monthlySpendUsd >= exaMonthlyBudgetUsd) return false;
  usage.dailyRequests += 1;
  saveExaUsage(usage);
  return true;
}

function recordExaCost(cost) {
  const value = Number(cost);
  if (!Number.isFinite(value) || value < 0) return;
  const usage = loadExaUsage();
  usage.monthlySpendUsd += value;
  saveExaUsage(usage);
}

function loadExaUsage() {
  const today = koreaDate();
  const month = today.slice(0, 7);
  if (!exaUsageState) {
    try {
      exaUsageState = JSON.parse(readFileSync(exaUsageFile, 'utf8'));
    } catch {
      exaUsageState = {};
    }
  }
  if (exaUsageState.day !== today) {
    exaUsageState.day = today;
    exaUsageState.dailyRequests = 0;
  }
  if (exaUsageState.month !== month) {
    exaUsageState.month = month;
    exaUsageState.monthlySpendUsd = 0;
  }
  exaUsageState.dailyRequests = Number(exaUsageState.dailyRequests) || 0;
  exaUsageState.monthlySpendUsd = Number(exaUsageState.monthlySpendUsd) || 0;
  return exaUsageState;
}

function koreaDate() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function saveExaUsage(usage) {
  mkdirSync(dirname(exaUsageFile), { recursive: true });
  writeFileSync(exaUsageFile, `${JSON.stringify(usage, null, 2)}\n`, 'utf8');
}

async function collectYoutube(keyword) {
  if (process.env.YOUTUBE_API_KEY) {
    return collectYoutubeApi(keyword);
  }

  const query = buildSearchQuery(keyword);
  const output = await runCommand('yt-dlp', [
    '--dump-json',
    '--skip-download',
    '--no-warnings',
    `ytsearch${youtubeResults}:${query}`,
  ]);
  return parseJsonLines(output.stdout)
    .filter((item) => item && (item.webpage_url || item.url))
    .map((item) => makeRow(keyword, {
      source: 'agent_reach_youtube',
      title: item.title,
      url: item.webpage_url || item.url,
      summary: item.description || item.channel || null,
      published_at: yyyymmddToIso(item.upload_date),
      query_stage: 'explore',
      source_layer: 'signal',
    }));
}

async function collectYoutubeApi(keyword) {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('key', process.env.YOUTUBE_API_KEY);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', buildYoutubeSearchQuery(keyword));
  url.searchParams.set('type', 'video');
  url.searchParams.set('order', 'date');
  url.searchParams.set('maxResults', String(Math.min(youtubeResults, 50)));
  url.searchParams.set('safeSearch', 'strict');
  url.searchParams.set('relevanceLanguage', 'ko');
  url.searchParams.set(
    'publishedAfter',
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  );

  const res = await fetchWithTimeout(url, timeoutMs);
  if (!res.ok) {
    throw new Error(`YouTube Data API HTTP ${res.status}`);
  }
  const payload = await res.json();
  return (payload.items || [])
    .filter((item) => item?.id?.videoId && item?.snippet?.title)
    .map((item) => makeRow(keyword, {
      source: 'agent_reach_youtube_api',
      title: item.snippet.title,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      summary: item.snippet.description || item.snippet.channelTitle || null,
      published_at: item.snippet.publishedAt || null,
      query_stage: 'explore',
      source_layer: 'signal',
    }));
}

function buildYoutubeSearchQuery(keyword) {
  const context = {
    ai_business: 'AI 비즈니스 자동화 에이전트',
    startup: '창업 부업 스타트업',
    policy: '정부 지원사업 소상공인',
  }[keyword.category] || '';
  return `${keyword.keyword} ${context}`.trim();
}

async function collectGithub(keyword) {
  if (keyword.category !== 'ai_business') return [];
  const query = buildGithubQuery(keyword);
  const output = await runCommand('gh', [
    'search',
    'repos',
    query,
    '--json',
    'fullName,description,url,updatedAt',
    '--limit',
    String(githubResults),
    '--sort',
    'updated',
  ]);
  const repos = parseJson(output.stdout);
  if (!Array.isArray(repos)) return [];
  return repos.map((repo) => makeRow(keyword, {
    source: 'agent_reach_github',
    title: repo.fullName,
    url: repo.url,
    summary: repo.description || null,
    published_at: repo.updatedAt || null,
    query_stage: 'precision',
    source_layer: 'signal',
  }));
}

function buildGithubQuery(keyword) {
  const value = String(keyword.keyword || '').toLowerCase();
  if (/노코드|rpa|업무\s*자동화|자동화/.test(value)) return 'workflow automation AI';
  if (/에이전트|agent/.test(value)) return 'AI agent automation';
  if (/llm|챗gpt|chatgpt|제미나이|gemini|클로드|claude|생성형/.test(value)) return 'LLM agent';
  if (/스타트업|saas|창업/.test(value)) return 'AI SaaS';
  return 'AI agent automation';
}

async function collectReddit(keyword) {
  const token = await getRedditAccessToken();
  const url = new URL('https://oauth.reddit.com/search');
  url.searchParams.set('q', buildRedditSearchQuery(keyword));
  url.searchParams.set('sort', 'new');
  url.searchParams.set('t', 'week');
  url.searchParams.set('type', 'link');
  url.searchParams.set('limit', String(Math.min(redditResults, 100)));
  url.searchParams.set('raw_json', '1');
  const res = await fetchWithTimeout(url, timeoutMs, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': redditUserAgent(),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Reddit HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const payload = await res.json();
  return (payload?.data?.children || [])
    .map((item) => item?.data)
    .filter((post) => post?.permalink && post?.title)
    .map((post) => makeRow(keyword, {
      source: 'agent_reach_reddit',
      title: post.title,
      url: `https://www.reddit.com${post.permalink}`,
      summary: post.selftext || post.url || null,
      published_at: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
      query_stage: 'explore',
      source_layer: 'signal',
    }));
}

async function getRedditAccessToken() {
  if (redditAccessToken?.expiresAt > Date.now() + 60000) return redditAccessToken.value;
  const clientId = requiredEnv('REDDIT_CLIENT_ID');
  const clientSecret = requiredEnv('REDDIT_CLIENT_SECRET');
  const res = await fetchWithTimeout('https://www.reddit.com/api/v1/access_token', timeoutMs, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': redditUserAgent(),
    },
    body: 'grant_type=client_credentials',
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.access_token) {
    throw new Error(`Reddit OAuth token request failed: ${payload.error || `HTTP ${res.status}`}`);
  }
  redditAccessToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 3600) - 60) * 1000,
  };
  return redditAccessToken.value;
}

async function collectRss(keyword) {
  const feeds = resolveRssFeeds();
  const matchingFeeds = feeds.filter((feed) => !feed.category || feed.category === keyword.category);
  const rows = [];

  for (const feed of matchingFeeds) {
    try {
      const entries = await loadRssEntries(feed);
      for (const entry of entries) {
        if (!entry.url || !entry.title) continue;
        if (!matchesKeyword(entry, keyword)) continue;
        const enriched = await maybeEnrichWithJina(entry);
        rows.push(makeRow(keyword, {
          source: `agent_reach_rss:${feed.name}`,
          title: enriched.title || entry.title,
          url: entry.url,
          summary: enriched.summary || entry.summary,
          published_at: entry.published_at,
          query_stage: 'explore',
          source_layer: isOfficialDomain(entry.url) ? 'official' : 'signal',
        }));
      }
    } catch (err) {
      rows.push(makeFailureRow(keyword, `agent_reach_rss:${feed.name}`, feed.url, err.message));
    }
  }

  return rows.filter((row) => !row.skip);
}

function loadRssEntries(feed) {
  if (!rssFeedCache.has(feed.url)) {
    rssFeedCache.set(feed.url, (async () => {
      const res = await fetchWithTimeout(feed.url, timeoutMs);
      if (!res.ok) throw new Error(`RSS HTTP ${res.status}: ${feed.url}`);
      const xml = await res.text();
      return parseRssEntries(xml).slice(0, intArg('rss-results', process.env.AGENT_REACH_RSS_RESULTS, 8));
    })());
  }
  return rssFeedCache.get(feed.url);
}

function parseRssEntries(xml) {
  const itemBlocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  const atomBlocks = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
  const blocks = itemBlocks.length ? itemBlocks : atomBlocks;
  return blocks.map((block) => {
    const atomHref = attr(block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[0] || '', 'href');
    return {
      title: decodeXml(tag(block, 'title')),
      url: decodeXml(tag(block, 'link') || atomHref || tag(block, 'guid')),
      summary: stripTags(decodeXml(tag(block, 'description') || tag(block, 'summary') || tag(block, 'content'))).slice(0, 700) || null,
      published_at: toIsoOrNull(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated')),
    };
  });
}

function matchesKeyword(entry, keyword) {
  const haystack = `${entry.title || ''} ${entry.summary || ''}`.toLowerCase();
  const terms = keyword.keyword.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  if (terms.some((term) => haystack.includes(term))) return true;
  return {
    ai_business: /\bai\b|artificial intelligence|llm|agent|model|openai|anthropic/i,
    startup: /startup|founder|venture|funding|saas|small business/i,
  }[keyword.category]?.test(haystack) || false;
}

async function maybeEnrichWithJina(result) {
  if (!jinaEnrich && result.summary) return result;
  if (jinaPageCache.has(result.url)) return jinaPageCache.get(result.url);
  const pending = (async () => {
  try {
    const res = await fetchWithTimeout(`https://r.jina.ai/${result.url}`, timeoutMs);
    if (!res.ok) return result;
    const text = await res.text();
    return {
      ...result,
      title: extractTitle(text) || result.title,
      summary: extractSummary(text) || result.summary,
    };
  } catch {
    return result;
  }
  })();
  jinaPageCache.set(result.url, pending);
  return pending;
}

function parseExaText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const result = { title: '', url: '', summary: '', published_at: null };
  let inHighlights = false;
  const highlights = [];

  for (const line of lines) {
    if (line.startsWith('Title:')) result.title = line.replace(/^Title:\s*/, '').trim();
    else if (line.startsWith('URL:')) result.url = line.replace(/^URL:\s*/, '').trim();
    else if (line.startsWith('Published:')) result.published_at = toIsoOrNull(line.replace(/^Published:\s*/, '').trim());
    else if (line.startsWith('Highlights:')) {
      inHighlights = true;
      highlights.push(line.replace(/^Highlights:\s*/, '').trim());
    } else if (inHighlights && line.trim()) {
      highlights.push(line.trim());
    }
  }

  result.summary = highlights.join(' ').slice(0, 700) || null;
  return result;
}

function makeRow(keyword, item) {
  const normalized = freeCollection.normalizeArticle({
    keyword_id: keyword.id || null,
    category: VALID_CATEGORIES.has(keyword.category) ? keyword.category : 'ai_business',
    source: item.source || 'agent_reach',
    title: item.title || item.url || 'Untitled',
    url: item.url,
    summary: item.summary,
    published_at: item.published_at,
    query_stage: item.query_stage || 'explore',
    source_layer: item.source_layer,
  });
  return normalized.row || {
    keyword_id: keyword.id || null,
    category: keyword.category,
    source: item.source || 'agent_reach',
    title: item.title || '',
    url: item.url || '',
    skip: true,
  };
}

function makeFailureRow(keyword, source, url, message) {
  return {
    ...makeRow(keyword, {
      source,
      title: `[수집 실패] ${message}`,
      url,
      summary: message,
      published_at: null,
    }),
    skip: true,
  };
}

async function upsertRawArticles(rows) {
  const url = `${requiredEnv('SUPABASE_URL')}/rest/v1/raw_articles?on_conflict=url`;
  const savedRows = [];
  for (const chunk of chunks(rows, 100)) {
    const saved = await supabaseRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(chunk),
    });
    savedRows.push(...(saved || []));
  }
  return savedRows;
}

async function assignEventClusters(rows) {
  if (!rows.length) return emptyClusterStats();
  const clusters = await loadRecentEventClusters();
  const affectedIds = new Set();
  const failures = [];
  let clustersCreated = 0;
  let articlesAssigned = 0;

  for (const row of rows) {
    try {
      const fingerprint = ensureEventFingerprint(row);
      const match = freeCollection.findClusterMatch(row, clusters);
      let cluster = match?.cluster || null;
      if (!cluster) {
        cluster = await createEventCluster(row);
        clusters.unshift(cluster);
        clustersCreated += 1;
      }
      await supabaseRequest(`${requiredEnv('SUPABASE_URL')}/rest/v1/raw_articles?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_cluster_id: cluster.id,
          event_fingerprint: fingerprint,
          cluster_match_method: match?.method || 'created',
          cluster_match_score: match?.score || 1,
        }),
      });
      row.event_cluster_id = cluster.id;
      articlesAssigned += 1;
      affectedIds.add(cluster.id);
    } catch (err) {
      failures.push({
        source: 'clusters',
        keyword: '',
        error: `Cluster assign failed for article ${row.id || ''}: ${err.message}`.slice(0, 500),
      });
    }
  }

  for (const clusterId of affectedIds) await refreshEventCluster(clusterId);
  return {
    articlesAssigned,
    clustersCreated,
    clustersUpdated: affectedIds.size,
    failures,
  };
}

async function backfillUnclusteredArticles() {
  const qs = new URLSearchParams({
    event_cluster_id: 'is.null',
    select: 'id,category,title,published_at,collected_at,event_fingerprint,source_type,quality_score',
    order: 'collected_at.desc',
    limit: '1000',
  });
  const rows = await supabaseRequest(`${requiredEnv('SUPABASE_URL')}/rest/v1/raw_articles?${qs.toString()}`);
  return assignEventClusters(rows);
}

async function backfillMissingClusterDates() {
  const qs = new URLSearchParams({
    event_date: 'is.null',
    select: 'id',
    order: 'last_seen_at.desc',
    limit: '200',
  });
  const clusters = await supabaseRequest(`${requiredEnv('SUPABASE_URL')}/rest/v1/event_clusters?${qs.toString()}`);
  for (const cluster of clusters) await refreshEventCluster(cluster.id);
}

async function upsertArticleFacts(rows) {
  const facts = rows.flatMap(extractFacts);
  if (!facts.length) return 0;
  const url = `${requiredEnv('SUPABASE_URL')}/rest/v1/article_facts?on_conflict=raw_article_id,fact_text`;
  for (const chunk of chunks(facts, 100)) {
    await supabaseRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });
  }
  return facts.length;
}

function extractFacts(article) {
  if (!article?.id || !article.event_cluster_id) return [];
  const text = cleanText(`${article.title || ''} ${article.summary || ''}`);
  const official = article.source_type === 'official';
  const sourceUrl = article.canonical_url || article.url;
  const candidates = [];
  collectMatches(candidates, text, /20\d{2}년(?:\s*\d{1,2}월)?(?:\s*\d{1,2}일)?/g, 'date');
  collectMatches(candidates, text, /\d[\d,.]*\s*(?:조\s*원|억\s*원|만\s*원|원|%|명|건|개|배|년|개월|일)/g, 'number');
  collectMatches(candidates, text, /["“]([^"”]{8,160})["”]/g, 'quote', 1);
  collectMatches(candidates, text, /(?:[가-힣A-Za-z0-9·&().-]+\s*){0,3}[가-힣A-Za-z0-9·&().-]{2,}(?:부|청|위원회|공단|진흥원|연구원|협회|재단|대학교|주식회사|Inc\.?|Corp\.?)/g, 'organization');

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.text;
    if (candidate.text.length < 2 || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20).map((candidate) => ({
    event_cluster_id: article.event_cluster_id,
    raw_article_id: article.id,
    fact_text: candidate.text,
    fact_type: candidate.type,
    source_url: sourceUrl,
    is_official: official,
    confidence: official ? 0.9 : candidate.type === 'quote' ? 0.7 : 0.65,
    verified_at: official ? new Date().toISOString() : null,
  }));
}

function collectMatches(target, text, regex, type, captureIndex = 0) {
  for (const match of text.matchAll(regex)) {
    const value = cleanText(match[captureIndex] || '');
    if (value) target.push({ type, text: value });
  }
}

async function loadRecentEventClusters() {
  const qs = new URLSearchParams({
    select: 'id,fingerprint,category,representative_title,event_date,last_seen_at',
    order: 'last_seen_at.desc',
    limit: '500',
  });
  return supabaseRequest(`${requiredEnv('SUPABASE_URL')}/rest/v1/event_clusters?${qs.toString()}`);
}

function findMatchingCluster(row, clusters) {
  return freeCollection.findMatchingCluster(row, clusters);
}

function ensureEventFingerprint(row) {
  if (row?.event_fingerprint) return row.event_fingerprint;
  const fingerprint = eventFingerprint(
    row?.title,
    row?.published_at || row?.collected_at,
    row?.category
  );
  if (row) row.event_fingerprint = fingerprint;
  return fingerprint;
}

async function createEventCluster(row) {
  const fingerprint = ensureEventFingerprint(row);
  if (!fingerprint) throw new Error('사건 클러스터 fingerprint가 없습니다.');
  const data = await supabaseRequest(`${requiredEnv('SUPABASE_URL')}/rest/v1/event_clusters?on_conflict=fingerprint`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      fingerprint,
      category: row.category,
      representative_title: row.title,
      event_date: eventDate(row.published_at || row.collected_at),
      article_count: 0,
      official_source_count: 0,
    }),
  });
  if (!data?.[0]) throw new Error('사건 클러스터 생성 결과가 없습니다.');
  return data[0];
}

async function refreshEventCluster(clusterId) {
  const qs = new URLSearchParams({
    event_cluster_id: `eq.${clusterId}`,
    select: 'title,source_domain,source_type,quality_score,published_at,collected_at',
    order: 'quality_score.desc',
    limit: '1000',
  });
  const articles = await supabaseRequest(`${requiredEnv('SUPABASE_URL')}/rest/v1/raw_articles?${qs.toString()}`);
  if (!articles.length) return;
  const officialCount = articles.filter((article) => article.source_type === 'official').length;
  const independentSourceCount = new Set(
    articles.map((article) => article.source_domain).filter(Boolean)
  ).size;
  const timestamps = articles.map((article) => article.collected_at).filter(Boolean).sort();
  const eventDates = articles.map((article) => eventDate(article.published_at || article.collected_at)).filter(Boolean).sort();
  const ready = articles.length >= 2 && (officialCount > 0 || Number(articles[0].quality_score) >= 70);
  await supabaseRequest(`${requiredEnv('SUPABASE_URL')}/rest/v1/event_clusters?id=eq.${clusterId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      representative_title: articles[0].title,
      event_date: eventDates[0] || null,
      first_seen_at: timestamps[0],
      last_seen_at: timestamps[timestamps.length - 1],
      article_count: articles.length,
      official_source_count: officialCount,
      independent_source_count: independentSourceCount,
      status: ready ? 'ready' : 'developing',
    }),
  });
}

async function touchKeywords(rows) {
  const ids = [...new Set(rows.map((row) => row.keyword_id).filter(Boolean))];
  const url = requiredEnv('SUPABASE_URL');
  for (const id of ids) {
    await supabaseRequest(`${url}/rest/v1/tracked_keywords?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ last_article_at: new Date().toISOString() }),
    });
  }
}

async function supabaseRequest(url, options = {}) {
  const key = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetchWithTimeout(url, timeoutMs, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function runCommand(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr || stdout}`.slice(0, 1200)));
    });
  });
}



async function fetchWithTimeout(url, ms, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseFeeds(value) {
  return splitList(value).map((entry) => {
    const [name, url, category] = entry.split('|').map((part) => part.trim());
    if (!url) return { name: hostName(name), url: name, category: null };
    return { name: name || hostName(url), url, category: category || null };
  }).filter((feed) => feed.url);
}

function isAgentReachKoreanRssEnabled(env = process.env) {
  return !/^(0|false|off|no)$/i.test(String(env.AGENT_REACH_KR_NEWS_RSS || '').trim());
}

function mergeFeedsByUrl(baseFeeds, extraFeeds) {
  const merged = [];
  const seen = new Set();
  for (const feed of [...(baseFeeds || []), ...(extraFeeds || [])]) {
    const url = String(feed?.url || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    merged.push({
      name: feed.name || hostName(url),
      url,
      category: feed.category || null,
    });
  }
  return merged;
}

function resolveRssFeeds(env = process.env) {
  const custom = String(env.AGENT_REACH_RSS_FEEDS || '').trim();
  const base = parseFeeds(custom || DEFAULT_RSS_FEEDS);
  if (!isAgentReachKoreanRssEnabled(env)) return base;
  return mergeFeedsByUrl(base, KOREAN_NEWS_FEEDS);
}

function buildSearchQuery(keyword) {
  const context = {
    ai_business: 'AI business automation agents enterprise latest',
    startup: 'startup side business monetization Korea latest',
    policy: 'Korea government support program SME startup policy latest',
  }[keyword.category] || 'latest news';
  return `${keyword.keyword} ${context}`.trim();
}

function buildRedditSearchQuery(keyword) {
  const context = {
    ai_business: 'AI agent automation business',
    startup: 'startup side hustle business',
    policy: 'small business funding government support',
  }[keyword.category] || 'business';
  return `${keyword.keyword} ${context}`.trim();
}

function redditUserAgent() {
  return process.env.REDDIT_USER_AGENT || 'script:coa-newsweaver:v1.0 (by /u/lycian57)';
}

function buildOfficialSearchQuery(keyword) {
  return buildLayeredOfficialSearchQuery(keyword);
}

function normalizeKeyword(raw) {
  return {
    id: raw.id || null,
    keyword: cleanText(raw.keyword || ''),
    category: VALID_CATEGORIES.has(raw.category) ? raw.category : 'ai_business',
  };
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const raw = arg.slice(2);
    const eq = raw.indexOf('=');
    if (eq === -1) out[raw] = 'true';
    else out[raw.slice(0, eq)] = raw.slice(eq + 1);
  }
  return out;
}

function intArg(name, envValue, fallback) {
  const value = args[name] ?? envValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function numberArg(name, envValue, fallback) {
  const value = args[name] ?? envValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function boolArg(name, fallback) {
  if (args[name] == null) return fallback;
  return parseBool(args[name], fallback);
}

function parseBool(value, fallback) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function splitList(value) {
  return String(value || '')
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    const match = String(value || '').match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    return match ? JSON.parse(match[1]) : null;
  }
}

function parseJsonLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function chunks(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? match[1].trim() : '';
}

function attr(tagText, name) {
  const match = tagText.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'));
  return match ? match[1] : '';
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

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanText(value) {
  return freeCollection.cleanText(value);
}

function normalizeUrl(value) {
  return freeCollection.normalizeUrl(value);
}

function classifySource(source, url) {
  return freeCollection.classifySource(source, url);
}

function isOfficialDomain(url) {
  return freeCollection.isOfficialDomain(url);
}

function scoreEvidence(title, summary) {
  return freeCollection.scoreEvidence(title, summary);
}

function scoreQuality(authority, evidence, publishedAt) {
  return freeCollection.scoreQuality(authority, evidence, publishedAt);
}

function eventFingerprint(title, publishedAt, category) {
  return freeCollection.eventFingerprint(title, publishedAt, category);
}

function titleSimilarity(left, right) {
  return freeCollection.titleSimilarity(left, right);
}

function eventDate(value) {
  return freeCollection.eventDate(value);
}

function dateDistanceDays(left, right) {
  return freeCollection.dateDistanceDays(left, right);
}

function toIsoOrNull(value) {
  return freeCollection.toIsoOrNull(value);
}

function yyyymmddToIso(value) {
  const text = String(value || '');
  if (!/^\d{8}$/.test(text)) return null;
  return toIsoOrNull(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00Z`);
}

function extractTitle(text) {
  const line = String(text || '').split(/\r?\n/).find((item) => /^Title:\s*/i.test(item) || /^#\s+/.test(item));
  return line ? cleanText(line.replace(/^Title:\s*/i, '').replace(/^#+\s*/, '')) : '';
}

function extractSummary(text) {
  return cleanText(String(text || '').replace(/https?:\/\/\S+/g, ' ')).slice(0, 700);
}

function hostName(url) {
  return freeCollection.hostName(url) || 'rss';
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
  return value;
}

module.exports = {
  buildRedditSearchQuery,
  buildGithubQuery,
  buildYoutubeSearchQuery,
  collectYoutube,
  collectExa,
  collectOfficial,
  buildOfficialSearchQuery,
  classifySource,
  dateDistanceDays,
  ensureEventFingerprint,
  eventFingerprint,
  extractFacts,
  isAgentReachKoreanRssEnabled,
  isOfficialDomain,
  findMatchingCluster,
  mergeFeedsByUrl,
  normalizeUrl,
  resolveRssFeeds,
  scoreEvidence,
  scoreQuality,
  selectHybridKeywords,
  titleSimilarity,
};
