const { randomUUID } = require('node:crypto');
const { getSupabase } = require('../../lib/supabase');
const { assertCronAuth } = require('../../lib/cronAuth');
const { searchNews } = require('../../lib/naver');
const { searchGoogleNews } = require('../../lib/googleNews');
const { fetchPolicyNotices } = require('../../lib/policySources');
const { fetchPublicDataNotices, getServiceKey } = require('../../lib/publicDataSources');
const { selectCollectionKeywords } = require('../../scripts/keyword-selection');
const { normalizeAndDedupe } = require('../../lib/freeCollection');

function stripHtml(str) {
  return String(str || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'");
}

function toIsoOrNull(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

module.exports = async (req, res) => {
  try {
    assertCronAuth(req);
  } catch (err) {
    res.status(err.statusCode || 401).json({ error: err.message });
    return;
  }

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    res.status(500).json({ error: err.message });
    return;
  }

  const { data: keywords, error: kwError } = await supabase
    .from('tracked_keywords')
    .select('id, keyword, category, datalab_priority')
    .eq('status', 'active')
    .eq('added_by', 'manual')
    .order('datalab_priority', { ascending: true })
    .order('id', { ascending: true });

  if (kwError) {
    res.status(500).json({ error: kwError.message });
    return;
  }

  let articlesUpserted = 0;
  let keywordFailures = 0;
  const runId = randomUUID();
  const runStartedAt = new Date().toISOString();
  const sourceFailures = [];
  const funnel = {
    discovered: 0,
    normalized: 0,
    unique: 0,
    stored: 0,
    rejection_counts: { invalid_url: 0, invalid_title: 0, duplicate_url: 0, duplicate_title: 0 },
  };
  const { data: recentArticles, error: articleError } = await supabase
    .from('raw_articles')
    .select('keyword_id,category,collected_at,tracked_keywords(keyword)')
    .in('category', ['ai_business', 'startup', 'policy'])
    .gte('collected_at', new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString())
    .not('keyword_id', 'is', null);
  if (articleError) console.error('[collect] rising keyword lookup failed:', articleError.message);

  const keywordSelection = selectCollectionKeywords(keywords || [], (recentArticles || []).map((article) => ({
    ...article,
    keyword: article.tracked_keywords?.keyword,
  })), {
    limitKeywords: process.env.BASE_COLLECT_LIMIT_KEYWORDS || 18,
    coreKeywordCount: process.env.BASE_COLLECT_CORE_KEYWORDS || 6,
    rotatingKeywordCount: process.env.BASE_COLLECT_ROTATING_KEYWORDS || 12,
    date: new Date(),
  });
  const selectedKeywords = keywordSelection.selected;
  const { error: runError } = await supabase.from('collection_runs').insert({
    id: runId,
    collector: 'vercel_cron',
    trigger: 'cron',
    status: 'running',
    sources: ['naver_news', 'google_news', 'policy_notice', 'public_data'],
    keywords_processed: selectedKeywords.length,
    started_at: runStartedAt,
  });
  if (runError) {
    res.status(500).json({ error: `collection_runs migration is required: ${runError.message}` });
    return;
  }

  for (const kw of selectedKeywords) {
    try {
      const [naverItems, googleItems] = await Promise.all([
        searchNews(kw.keyword).catch((e) => {
          console.error(`[collect] 네이버 검색 실패 (${kw.keyword}):`, e.message);
          return [];
        }),
        searchGoogleNews(kw.keyword).catch((e) => {
          console.error(`[collect] 구글 뉴스 실패 (${kw.keyword}):`, e.message);
          return [];
        }),
      ]);

      const rows = [
        ...naverItems.map((item) => ({
          keyword_id: kw.id,
          category: kw.category,
          source: 'naver_news',
          title: stripHtml(item.title),
          url: item.originallink || item.link,
          summary: stripHtml(item.description || ''),
          published_at: toIsoOrNull(item.pubDate),
          discovery_channel: 'naver_news',
        })),
        ...googleItems.map((item) => ({
          keyword_id: kw.id,
          category: kw.category,
          source: 'google_news',
          title: item.title,
          url: item.link,
          summary: null,
          published_at: toIsoOrNull(item.pubDate),
          discovery_channel: 'google_news',
          publisher_name: item.sourceName || null,
          publisher_url: item.sourceUrl || null,
        })),
      ];

      const normalized = addToFunnel(funnel, rows);
      if (normalized.length) {
        const { error: upsertError } = await supabase
          .from('raw_articles')
          .upsert(normalized, { onConflict: 'url', ignoreDuplicates: true });
        if (upsertError) throw upsertError;

        articlesUpserted += normalized.length;
        funnel.stored += normalized.length;
        await supabase
          .from('tracked_keywords')
          .update({ last_article_at: new Date().toISOString() })
          .eq('id', kw.id);
      }
    } catch (err) {
      keywordFailures += 1;
      sourceFailures.push({ source: 'keyword', keyword: kw.keyword, error: err.message });
      console.error(`[collect] "${kw.keyword}" 처리 실패:`, err.message);
    }
  }

  let policyNoticesUpserted = 0;
  let publicApiNoticesUpserted = 0;
  try {
    const notices = await fetchPolicyNotices();
    const policyRows = notices.map((n) => ({
      keyword_id: null,
      category: 'policy',
      source: n.source,
      title: n.title,
      url: n.url,
      summary: null,
      published_at: null,
    }));
    const normalized = addToFunnel(funnel, policyRows);
    if (normalized.length) {
      const { error: upsertError } = await supabase
        .from('raw_articles')
        .upsert(normalized, { onConflict: 'url', ignoreDuplicates: true });
      if (upsertError) throw upsertError;
      policyNoticesUpserted = normalized.length;
      funnel.stored += normalized.length;
    }
  } catch (err) {
    sourceFailures.push({ source: 'policy_notice', error: err.message });
    console.error('[collect] 정책 소스 수집 실패:', err.message);
  }

  try {
    const notices = await fetchPublicDataNotices();
    const publicApiRows = notices.map((n) => ({
      keyword_id: null,
      category: n.category,
      source: n.source,
      title: n.title,
      url: n.url,
      summary: n.summary,
      published_at: n.published_at,
    }));
    const normalized = addToFunnel(funnel, publicApiRows);
    if (normalized.length) {
      const { error: upsertError } = await supabase
        .from('raw_articles')
        .upsert(normalized, { onConflict: 'url', ignoreDuplicates: true });
      if (upsertError) throw upsertError;
      publicApiNoticesUpserted = normalized.length;
      funnel.stored += normalized.length;
    }
  } catch (err) {
    sourceFailures.push({ source: 'public_data', error: err.message });
    console.error('[collect] 공공데이터 API 수집 실패:', err.message);
  }

  const status = sourceFailures.length ? 'partial' : 'succeeded';
  const completedAt = new Date().toISOString();
  const { error: finishError } = await supabase.from('collection_runs').update({
    status,
    completed_at: completedAt,
    discovered_count: funnel.discovered,
    normalized_count: funnel.normalized,
    unique_count: funnel.unique,
    stored_count: funnel.stored,
    rejection_counts: funnel.rejection_counts,
    source_failures: sourceFailures,
  }).eq('id', runId);
  if (finishError) console.error('[collect] collection run finalize failed:', finishError.message);

  res.status(200).json({
    collectionRunId: runId,
    status,
    keywordsProcessed: selectedKeywords.length,
    keywordFailures,
    articlesUpserted,
    policyNoticesUpserted,
    publicApiConfigured: Boolean(getServiceKey()),
    publicApiNoticesUpserted,
    risingKeywordsApplied: keywordSelection.rising.length,
    funnel,
    completedAt,
  });
};

function addToFunnel(target, rows) {
  const normalized = normalizeAndDedupe(rows);
  target.discovered += normalized.funnel.discovered;
  target.normalized += normalized.funnel.normalized;
  target.unique += normalized.funnel.unique;
  for (const [reason, count] of Object.entries(normalized.funnel.rejection_counts)) {
    target.rejection_counts[reason] += count;
  }
  return normalized.rows;
}
