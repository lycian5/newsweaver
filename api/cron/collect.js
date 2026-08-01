const { getSupabase } = require('../../lib/supabase');
const { assertCronAuth } = require('../../lib/cronAuth');
const { searchNews } = require('../../lib/naver');
const { searchGoogleNews } = require('../../lib/googleNews');
const { fetchPolicyNotices } = require('../../lib/policySources');
const { selectHybridKeywords } = require('../../scripts/keyword-selection');

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
  const selectedKeywords = selectHybridKeywords(keywords || [], {
    limitKeywords: process.env.BASE_COLLECT_LIMIT_KEYWORDS || 18,
    coreKeywordCount: process.env.BASE_COLLECT_CORE_KEYWORDS || 6,
    rotatingKeywordCount: process.env.BASE_COLLECT_ROTATING_KEYWORDS || 12,
    date: new Date(),
  });

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
          url: item.link,
          summary: stripHtml(item.description || ''),
          published_at: toIsoOrNull(item.pubDate),
        })),
        ...googleItems.map((item) => ({
          keyword_id: kw.id,
          category: kw.category,
          source: 'google_news',
          title: item.title,
          url: item.link,
          summary: null,
          published_at: toIsoOrNull(item.pubDate),
        })),
      ];

      if (rows.length) {
        const { error: upsertError } = await supabase
          .from('raw_articles')
          .upsert(rows, { onConflict: 'url', ignoreDuplicates: true });
        if (upsertError) throw upsertError;

        articlesUpserted += rows.length;
        await supabase
          .from('tracked_keywords')
          .update({ last_article_at: new Date().toISOString() })
          .eq('id', kw.id);
      }
    } catch (err) {
      keywordFailures += 1;
      console.error(`[collect] "${kw.keyword}" 처리 실패:`, err.message);
    }
  }

  let policyNoticesUpserted = 0;
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
    if (policyRows.length) {
      const { error: upsertError } = await supabase
        .from('raw_articles')
        .upsert(policyRows, { onConflict: 'url', ignoreDuplicates: true });
      if (upsertError) throw upsertError;
      policyNoticesUpserted = policyRows.length;
    }
  } catch (err) {
    console.error('[collect] 정책 소스 수집 실패:', err.message);
  }

  res.status(200).json({
    keywordsProcessed: selectedKeywords.length,
    keywordFailures,
    articlesUpserted,
    policyNoticesUpserted,
  });
};
