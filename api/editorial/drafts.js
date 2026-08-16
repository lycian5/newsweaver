const { getSupabase } = require('../../lib/supabase');
const { getOpenAI } = require('../../lib/openai');
const { resolveOpenAIImageModel } = require('../../lib/openaiModels');
const {
  buildEvidence,
  buildImagePrompt,
  reviewDraftEvidence,
  sanitizeArticleHtml,
} = require('../../lib/editorialAi');
const { generateBriefSummaryReview, generateEditorialProposal, resolveEditorialAiRoute } = require('../../lib/editorialAiProvider');
const { recordAiUsage, reserveAiBudget } = require('../../lib/editorialAiBudget');
const {
  assertCronAuth,
  clearDashboardSessionCookie,
  createDashboardSessionCookie,
  verifyDashboardPassword,
  verifyDashboardSession,
} = require('../../lib/cronAuth');
const { selectCollectionKeywords } = require('../../scripts/keyword-selection');
const { selectRisingKeywords } = require('../../scripts/rising-keywords');
const {
  gradeSource,
  sourceGradeRank,
  validateBriefForPreparation: evaluateBriefPolicy,
} = require('../../lib/editorialPolicy');
const { classificationFromDraft, mapPlatformCategory } = require('../../lib/platformCategories');
const { applyReviewToDigest, buildBriefDigest, classifyAfterAiReview } = require('../../lib/briefDigest');
const { attachStoredReview, summaryHash } = require('../../lib/briefSummaryReviewJob');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'POST' && req.body?.action === 'login') return login(req, res);
  if (req.method === 'POST' && req.body?.action === 'logout') return logout(req, res);
  if (req.method === 'GET' && req.query?.view === 'session') {
    return res.status(200).json({ authenticated: verifyDashboardSession(req) });
  }
  try { assertCronAuth(req); } catch (err) { res.status(err.statusCode || 401).json({ error: err.message }); return; }
  try {
    if (req.method === 'GET' && req.query?.view === 'briefs') return listBriefs(req, res);
    if (req.method === 'GET' && req.query?.view === 'brief') return getBrief(req, res);
    if (req.method === 'GET' && req.query?.view === 'keywords') return listKeywords(req, res);
    if (req.method === 'GET' && req.query?.view === 'rising-keywords') return listRisingKeywords(req, res);
    if (req.method === 'GET' && req.query?.view === 'collection-status') return listCollectionStatus(req, res);
    if (req.method === 'GET') return listDrafts(req, res);
    if (req.method === 'POST' && req.body?.action === 'prepare') return prepareArticleDraft(req, res);
    if (req.method === 'POST' && req.body?.action === 'ai_generate') return generateDraftWithAi(req, res);
    if (req.method === 'POST' && req.body?.action === 'ai_verify') return verifyDraftEvidence(req, res);
    if (req.method === 'POST' && req.body?.action === 'ai_verify_brief') return verifyBriefSummary(req, res);
    if (req.method === 'POST' && req.body?.action === 'ai_generate_image') return generateDraftImage(req, res);
    if (req.method === 'POST' && ['start_review', 'hold', 'resume', 'archive'].includes(req.body?.action)) return updateBriefState(req, res);
    if (req.method === 'PATCH') return updateDraft(req, res);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[editorial/drafts]', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

async function login(req, res) {
  if (!process.env.DASHBOARD_PASSWORD) {
    return res.status(503).json({ error: 'DASHBOARD_PASSWORD is not configured' });
  }
  if (!verifyDashboardPassword(req.body?.password)) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return res.status(401).json({ error: '로그인 정보가 올바르지 않습니다.' });
  }
  res.setHeader('Set-Cookie', createDashboardSessionCookie());
  return res.status(200).json({ ok: true, expiresIn: 604800 });
}

function logout(req, res) {
  res.setHeader('Set-Cookie', clearDashboardSessionCookie());
  return res.status(200).json({ ok: true });
}

async function listKeywords(req, res) {
  const supabase = getSupabase();
  const limitKeywords = clamp(
    req.query?.limitKeywords,
    1,
    100,
    Number(process.env.AGENT_REACH_LIMIT_KEYWORDS || 54)
  );
  const coreKeywordCount = Number(process.env.AGENT_REACH_CORE_KEYWORDS || 12);
  const rotatingKeywordCount = Number(process.env.AGENT_REACH_ROTATING_KEYWORDS || 42);
  const { data: keywords, error } = await supabase
    .from('tracked_keywords')
    .select('id, keyword, category, datalab_priority')
    .eq('status', 'active')
    .eq('added_by', 'manual')
    .order('datalab_priority', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;

  const { data: articles, error: articleError } = await supabase
    .from('raw_articles')
    .select('keyword_id, category, collected_at, tracked_keywords(keyword)')
    .in('category', ['ai_business', 'startup', 'policy'])
    .gte('collected_at', new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString())
    .not('keyword_id', 'is', null);
  if (articleError) throw articleError;
  const keywordSelection = selectCollectionKeywords(keywords || [], (articles || []).map((article) => ({
    ...article,
    keyword: article.tracked_keywords?.keyword,
  })), {
    limitKeywords,
    coreKeywordCount,
    rotatingKeywordCount,
    date: new Date(),
  });
  const koreaDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  res.status(200).json({
    date: koreaDate,
    core: keywordSelection.core,
    rising: keywordSelection.rising,
    rotating: keywordSelection.rotating,
  });
}

async function listRisingKeywords(req, res) {
  const supabase = getSupabase();
  const since = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const { data: articles, error } = await supabase
    .from('raw_articles')
    .select('keyword_id, category, collected_at, tracked_keywords(keyword)')
    .in('category', ['ai_business', 'startup', 'policy'])
    .gte('collected_at', since)
    .not('keyword_id', 'is', null);
  if (error) throw error;

  const items = selectRisingKeywords(
    (articles || []).map((article) => ({ ...article, keyword: article.tracked_keywords?.keyword }))
  );
  res.status(200).json({ date: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10), items });
}

async function listCollectionStatus(req, res) {
  const supabase = getSupabase();
  const koreaDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const startAt = new Date(`${koreaDate}T00:00:00+09:00`).toISOString();
  const { data, error } = await supabase
    .from('collection_runs')
    .select('id,collector,trigger,collection_mode,status,sources,stored_count,discovered_count,ready_brief_count,source_failures,recovery_reason,started_at,completed_at')
    .gte('started_at', startAt)
    .order('started_at', { ascending: false })
    .limit(30);
  if (error) throw error;

  const runs = data || [];
  const primary = firstRun(runs, (run) => run.collector === 'vercel_cron' && run.collection_mode !== 'previous_day_recovery');
  const recovery = firstRun(runs, (run) => run.collection_mode === 'previous_day_recovery' || run.trigger === 'recovery');
  const agentReach = firstRun(runs, (run) => run.collector === 'agent_reach');
  const koreaHour = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCHours();

  res.status(200).json({
    date: koreaDate,
    primary: summarizeDayRun(primary, {
      waitingLabel: koreaHour < 8 ? '대기' : '미실행',
      emptyTitle: koreaHour < 8 ? '아직 실행 전' : '오늘 기록이 없습니다',
    }),
    recovery: recovery
      ? summarizeDayRun(recovery, {})
      : skippedRecovery(primary),
    agentReach: summarizeDayRun(agentReach, {
      waitingLabel: koreaHour < 16 ? '대기' : '미실행',
      emptyTitle: koreaHour < 16 ? '오후 보강 전' : '오늘 기록이 없습니다',
    }),
  });
}

function firstRun(runs, match) {
  return (runs || []).find(match) || null;
}

function skippedRecovery(primary) {
  if (primary && ['succeeded', 'partial'].includes(primary.status)) {
    return {
      kind: 'skip',
      label: '건너뜀',
      title: '재수집 없음',
      detail: '주수집이 정상이라 보정하지 않았습니다.',
      stored: 0,
      completedAt: null,
      sources: [],
    };
  }
  return {
    kind: 'idle',
    label: '대기',
    title: '보정 전',
    detail: '주수집 결과에 따라 09시대에만 실행됩니다.',
    stored: 0,
    completedAt: null,
    sources: [],
  };
}

function summarizeDayRun(run, { waitingLabel = '대기', emptyTitle = '오늘 기록이 없습니다' } = {}) {
  if (!run) {
    return {
      kind: waitingLabel === '미실행' ? 'warn' : 'idle',
      label: waitingLabel,
      title: emptyTitle,
      detail: waitingLabel === '미실행' ? '오늘 실행 기록이 없습니다.' : '예정 시각 전입니다.',
      stored: 0,
      completedAt: null,
      sources: [],
    };
  }
  const failures = Array.isArray(run.source_failures) ? run.source_failures.length : 0;
  const kind = run.status === 'succeeded' ? 'ok' : run.status === 'running' ? 'idle' : 'warn';
  const labels = { succeeded: '성공', partial: '부분 실패', failed: '실패', running: '실행 중' };
  return {
    kind,
    label: labels[run.status] || run.status,
    title: `${Number(run.stored_count || 0)}건 저장`,
    detail: [
      (run.sources || []).join(' · ') || '출처 없음',
      run.completed_at || run.started_at,
      failures ? `실패 ${failures}건` : '실패 없음',
      run.ready_brief_count ? `브리프 ${run.ready_brief_count}건` : '',
      run.recovery_reason || '',
    ].filter(Boolean).join(' · '),
    stored: Number(run.stored_count || 0),
    completedAt: run.completed_at || run.started_at,
    sources: run.sources || [],
  };
}

async function listBriefs(req, res) {
  const supabase = getSupabase();
  const limit = clamp(req.query?.limit, 1, 100, 100);
  const clusters = await fetchBriefClusters(supabase, req, limit);
  const ids = (clusters || []).map((item) => item.id);
  if (!ids.length) return res.status(200).json({ briefs: [], metrics: emptyBriefMetrics(), collection: collectionHealth([]) });
  const [{ data: articles, error: articleError }, { data: facts, error: factError }] = await Promise.all([
    supabase.from('raw_articles').select('event_cluster_id,title,url,summary,published_at,source_domain,source_type,source_layer,authority_score,quality_score,verification_status').in('event_cluster_id', ids),
    supabase.from('article_facts').select('event_cluster_id,fact_text,fact_type,is_official').in('event_cluster_id', ids),
  ]);
  if (articleError) throw articleError;
  if (factError) throw factError;
  let briefs = clusters.map((cluster) => summarizeBrief(
    cluster,
    (articles || []).filter((item) => item.event_cluster_id === cluster.id),
    (facts || []).filter((item) => item.event_cluster_id === cluster.id)
  ));
  if (req.query?.sourceLayer) briefs = briefs.filter((brief) => brief.source_layers.includes(req.query.sourceLayer));
  briefs = sortBriefs(briefs, req.query?.sort || 'attention');
  res.status(200).json({ briefs, metrics: briefMetrics(briefs), collection: collectionHealth(clusters) });
}

async function getBrief(req, res) {
  const clusterId = Number.parseInt(req.query?.id, 10);
  if (!clusterId) return res.status(400).json({ error: 'id is required' });
  const supabase = getSupabase();
  const [{ data: cluster, error: clusterError }, { data: articles, error: articleError }, { data: facts, error: factError }] = await Promise.all([
    supabase.from('event_clusters').select('*').eq('id', clusterId).single(),
    supabase.from('raw_articles').select('id,event_cluster_id,title,url,summary,published_at,collected_at,source,source_domain,source_type,source_layer,query_stage,authority_score,quality_score,verification_status').eq('event_cluster_id', clusterId),
    supabase.from('article_facts').select('id,event_cluster_id,raw_article_id,fact_text,fact_type,source_url,is_official,confidence,verified_at,created_at').eq('event_cluster_id', clusterId).order('confidence', { ascending: false }),
  ]);
  if (clusterError) throw clusterError;
  if (articleError) throw articleError;
  if (factError) throw factError;
  const normalizedCluster = normalizeBriefCluster(cluster);
  const sortedArticles = sortEvidence(articles || []);
  const validation = validateBriefForPreparation(normalizedCluster, sortedArticles, facts || []);
  const digest = buildBriefDigest(normalizedCluster, sortedArticles, facts || [], validation);
  const aiReview = attachStoredReview(normalizedCluster, digest);
  applyReviewToDigest(digest, validation, sortedArticles, aiReview);
  res.status(200).json({
    brief: {
      ...normalizedCluster,
      independent_source_count: independentSourceCount(sortedArticles),
      articles: sortedArticles,
      facts: facts || [],
      digest,
      validation,
      aiReview,
      history: [
        { type: 'collected', at: normalizedCluster.first_seen_at, label: '최초 수집' },
        { type: 'updated', at: normalizedCluster.last_seen_at, label: '최근 근거 갱신' },
        ...(normalizedCluster.editorial_state === 'prepared' && normalizedCluster.prepared_draft_id
          ? [{ type: 'prepared', at: null, label: '기사 초안으로 전환' }]
          : []),
      ],
    },
  });
}

async function updateBriefState(req, res) {
  const clusterId = Number.parseInt(req.body?.eventClusterId, 10);
  if (!clusterId) return res.status(400).json({ error: 'eventClusterId is required' });
  const supabase = getSupabase();
  const { data: current, error: readError } = await supabase
    .from('event_clusters')
    .select('id,status,editorial_state,prepared_draft_id')
    .eq('id', clusterId)
    .single();
  if (isMissingBriefMetadata(readError)) {
    return res.status(409).json({ error: '리서치 브리프 데이터베이스 마이그레이션 적용이 필요합니다.' });
  }
  if (readError) throw readError;
  const transitions = {
    start_review: { from: ['unreviewed'], updates: { editorial_state: 'reviewing' } },
    hold: { from: ['unreviewed', 'reviewing'], updates: { editorial_state: 'held' } },
    resume: { from: ['held'], updates: { editorial_state: 'reviewing' } },
    archive: { from: ['unreviewed', 'reviewing', 'held'], updates: { status: 'archived' } },
  };
  const transition = transitions[req.body.action];
  if (!transition || !transition.from.includes(current.editorial_state)) {
    return res.status(409).json({ error: `허용되지 않은 브리프 상태 전환입니다: ${current.editorial_state} -> ${req.body.action}` });
  }
  const { data, error } = await supabase
    .from('event_clusters')
    .update(transition.updates)
    .eq('id', clusterId)
    .select('id,status,editorial_state,prepared_draft_id')
    .single();
  if (error) throw error;
  return res.status(200).json({ brief: data });
}

async function listDrafts(req, res) {
  const supabase = getSupabase();
  let query = supabase.from('editorial_drafts').select('*').order('updated_at', { ascending: false }).limit(100);
  if (req.query?.id) query = query.eq('id', req.query.id);
  if (req.query?.status) query = query.eq('status', req.query.status);
  const { data, error } = await query;
  if (error) throw error;
  const drafts = await attachDraftAssets(supabase, data || []);
  res.status(200).json({ drafts: await attachDraftClassification(supabase, drafts) });
}

async function prepareArticleDraft(req, res) {
  const clusterId = Number.parseInt(req.body?.eventClusterId, 10);
  if (!clusterId) return res.status(400).json({ error: 'eventClusterId is required' });
  const supabase = getSupabase();
  const [{ data: cluster, error: clusterError }, { data: articles, error: articleError }, { data: facts, error: factError }] = await Promise.all([
    supabase.from('event_clusters').select('*').eq('id', clusterId).single(),
    supabase.from('raw_articles').select('title,url,summary,published_at,source_domain,source_type,source_layer,authority_score,quality_score,verification_status').eq('event_cluster_id', clusterId).order('quality_score', { ascending: false }),
    supabase.from('article_facts').select('fact_text,fact_type,source_url,is_official,confidence').eq('event_cluster_id', clusterId).order('confidence', { ascending: false }),
  ]);
  if (clusterError) throw clusterError;
  if (articleError) throw articleError;
  if (factError) throw factError;
  if (!hasBriefWorkflowColumns(cluster)) {
    return res.status(409).json({ error: '리서치 브리프 데이터베이스 마이그레이션 적용이 필요합니다.' });
  }
  if (cluster.editorial_state === 'prepared' && cluster.prepared_draft_id) {
    return res.status(409).json({ error: '이미 기사 초안으로 전환된 브리프입니다.', draftId: cluster.prepared_draft_id });
  }
  const validation = validateBriefForPreparation(cluster, articles, facts);
  if (!validation.can_prepare) return res.status(409).json({ error: validation.blockers[0], validation });
  const digest = buildBriefDigest(cluster, articles, facts, validation);
  const aiReview = attachStoredReview(cluster, digest);
  applyReviewToDigest(digest, validation, articles, aiReview);
  if (aiReview && aiReview.verdict !== 'supported') {
    return res.status(409).json({ error: digest.decision.reason, validation, review: aiReview });
  }
  const starter = buildArticleStarter(cluster, articles, facts, digest);
  const classification = mapPlatformCategory(cluster.category);
  const row = {
    event_cluster_id: clusterId,
    title: starter.title,
    subtitle: null,
    summary: starter.summary,
    body_html: starter.bodyHtml,
    tags: classification.tags,
    platform_category_id: classification.category,
    additional_category_1: classification.additionalCategory1 || null,
    additional_category_2: classification.additionalCategory2 || null,
    source_url: starter.primarySource.url || null,
    status: 'draft',
    model: null,
  };
  const { data, error } = await insertEditorialDraft(supabase, row);
  if (error) throw error;
  const { error: clusterUpdateError } = await supabase
    .from('event_clusters')
    .update({ editorial_state: 'prepared', prepared_draft_id: data.id })
    .eq('id', clusterId);
  if (clusterUpdateError) throw clusterUpdateError;
  res.status(201).json({
    draft: data,
    validation,
    seed: {
      title: starter.title,
      summary: starter.summary,
      source_name: starter.primarySource.source_domain || 'COA NEWS 리서치',
      source_url: starter.primarySource.url || '',
      category: cluster.category,
      classification,
      event_cluster_id: clusterId,
      draft_id: data.id,
      references: articles.map((article) => article.url).filter(Boolean),
      facts: facts.map((fact) => ({
        text: fact.fact_text,
        source_url: fact.source_url,
        is_official: fact.is_official,
        confidence: fact.confidence,
      })),
      digest,
      validation,
    },
  });
}

async function fetchBriefClusters(supabase, req, limit) {
  let legacy = false;
  let { data: clusters, error } = await briefClusterQuery(supabase, req, limit, legacy);
  if (isMissingBriefMetadata(error)) {
    legacy = true;
    ({ data: clusters, error } = await briefClusterQuery(supabase, req, limit, legacy));
  }
  if (error) throw error;
  const normalized = (clusters || []).map(normalizeBriefCluster);
  if (legacy && req.query?.editorialState && req.query.editorialState !== 'unreviewed') return [];
  return normalized;
}

function briefClusterQuery(supabase, req, limit, legacy) {
  const columns = legacy
    ? 'id,category,representative_title,event_date,first_seen_at,last_seen_at,article_count,official_source_count,status'
    : 'id,category,representative_title,event_date,first_seen_at,last_seen_at,article_count,official_source_count,independent_source_count,editorial_state,prepared_draft_id,status,validation_snapshot';
  let query = supabase.from('event_clusters').select(columns).order('last_seen_at', { ascending: false }).limit(limit);
  if (req.query?.category) query = query.eq('category', req.query.category);
  if (req.query?.status) query = query.eq('status', req.query.status);
  if (!legacy && req.query?.editorialState) query = query.eq('editorial_state', req.query.editorialState);
  if (req.query?.freshness && req.query.freshness !== 'all') {
    const hours = { '24h': 24, '7d': 168, '30d': 720 }[req.query.freshness];
    if (hours) query = query.gte('last_seen_at', new Date(Date.now() - hours * 3600000).toISOString());
  }
  if (req.query?.search) query = query.ilike('representative_title', `%${String(req.query.search).slice(0, 100)}%`);
  return query;
}

function normalizeBriefCluster(cluster) {
  return {
    ...cluster,
    independent_source_count: Number(cluster?.independent_source_count || 0),
    editorial_state: cluster?.editorial_state || 'unreviewed',
    prepared_draft_id: cluster?.prepared_draft_id || null,
  };
}

function isMissingBriefMetadata(error) {
  return error?.code === '42703' && /independent_source_count|editorial_state|prepared_draft_id|validation_snapshot/.test(error.message || '');
}

function hasBriefWorkflowColumns(cluster) {
  return Object.prototype.hasOwnProperty.call(cluster || {}, 'editorial_state')
    && Object.prototype.hasOwnProperty.call(cluster || {}, 'prepared_draft_id');
}

async function updateDraft(req, res) {
  const id = Number.parseInt(req.body?.id, 10);
  if (!id) return res.status(400).json({ error: 'id is required' });
  const supabase = getSupabase();
  const { data: current, error: readError } = await supabase.from('editorial_drafts').select('*').eq('id', id).single();
  if (readError) throw readError;
  const action = req.body?.action || 'save';
  const now = new Date().toISOString();
  const updates = { updated_at: now };
  if (action === 'save') {
    if (!['draft', 'rejected'].includes(current.status)) return res.status(409).json({ error: '승인대기 또는 승인 완료 초안은 수정할 수 없습니다.' });
    for (const [input, column] of [['title','title'],['subtitle','subtitle'],['summary','summary'],['bodyHtml','body_html'],['editorialNotes','editorial_notes']]) {
      if (typeof req.body?.[input] === 'string') updates[column] = req.body[input];
    }
    if (Array.isArray(req.body?.tags)) updates.tags = req.body.tags.slice(0, 20);
    if (typeof req.body?.platformCategoryId === 'string') updates.platform_category_id = req.body.platformCategoryId.trim().slice(0, 20) || null;
    if (typeof req.body?.additionalCategory1 === 'string') updates.additional_category_1 = req.body.additionalCategory1.trim().slice(0, 20) || null;
    if (typeof req.body?.additionalCategory2 === 'string') updates.additional_category_2 = req.body.additionalCategory2.trim().slice(0, 20) || null;
    if (typeof req.body?.sourceUrl === 'string') updates.source_url = req.body.sourceUrl.trim().slice(0, 2000) || null;
    updates.status = 'draft';
  } else if (action === 'submit' && ['draft', 'rejected'].includes(current.status)) {
    const problems = validateArticleDraft(current);
    if (problems.length) return res.status(400).json({ error: problems[0], problems });
    updates.status = 'pending_editor_approval'; updates.submitted_at = now; updates.decided_at = null;
  } else if (action === 'approve' && current.status === 'pending_editor_approval') {
    updates.status = 'approved'; updates.decided_at = now;
  } else if (action === 'reject' && current.status === 'pending_editor_approval') {
    const note = String(req.body?.editorialNotes || '').trim();
    if (!note) return res.status(400).json({ error: '반려 사유를 편집 메모에 입력하세요.' });
    updates.status = 'rejected'; updates.decided_at = now; updates.editorial_notes = note.slice(0, 3000);
  } else {
    return res.status(409).json({ error: `허용되지 않은 상태 전환입니다: ${current.status} -> ${action}` });
  }
  const { data, error } = await updateEditorialDraft(supabase, id, updates);
  if (error) throw error;
  if (action === 'save' && current.latest_image_asset_id) {
    const imageUpdates = {};
    if (typeof req.body?.thumbnailAlt === 'string') imageUpdates.alt_text = req.body.thumbnailAlt.trim().slice(0, 300) || null;
    if (typeof req.body?.thumbnailCaption === 'string') imageUpdates.caption = req.body.thumbnailCaption.trim().slice(0, 300) || null;
    if (typeof req.body?.thumbnailSource === 'string') imageUpdates.source = req.body.thumbnailSource.trim().slice(0, 300) || null;
    if (Object.keys(imageUpdates).length) {
      const { error: assetError } = await supabase.from('editorial_assets').update(imageUpdates).eq('id', current.latest_image_asset_id);
      if (assetError) throw assetError;
    }
  }
  res.status(200).json({ draft: data });
}

async function generateDraftWithAi(req, res) {
  const id = Number.parseInt(req.body?.id, 10);
  if (!id) return res.status(400).json({ error: 'id is required' });
  const supabase = getSupabase();
  const schemaError = await ensureAiSchema(supabase);
  if (schemaError) return res.status(409).json({ error: 'AI 초안 데이터베이스 마이그레이션 적용이 필요합니다.' });
  const { draft, cluster, articles, facts } = await loadDraftAiContext(supabase, id);
  if (!['draft', 'rejected'].includes(draft.status)) return res.status(409).json({ error: '검토 대기 또는 승인된 초안은 AI로 수정할 수 없습니다.' });
  const validation = validateBriefForPreparation(cluster, articles, facts);
  if (!validation.can_prepare) return res.status(409).json({ error: validation.blockers[0], validation });

  const currentDraft = requestedDraftSnapshot(req.body?.draft, draft);
  const context = buildEvidence(cluster, articles, facts);
  const route = resolveEditorialAiRoute({ tier: req.body?.tier, requestedModel: req.body?.model });
  const scope = String(req.body?.scope || 'full').slice(0, 40);
  const reserved = await reserveAiBudget(supabase, { draftId: id, route, context, scope });
  let proposal;
  let usage;
  try {
    ({ proposal, usage } = await generateEditorialProposal(route, context, {
      scope,
      tone: req.body?.tone,
      length: req.body?.length,
      instructions: req.body?.instructions,
      currentDraft,
    }));
  } catch (err) {
    await recordAiUsage(supabase, { draftId: id, route, scope, reserved, status: 'failed', errorMessage: err.message });
    throw err;
  }
  const review = reviewDraftEvidence(proposal, context.urls);
  const prompt = String(req.body?.instructions || '').trim().slice(0, 1200);
  await insertAiDraftVersion(supabase, {
    draft_id: id,
    action: `ai_${String(req.body?.scope || 'full').slice(0, 40)}`,
    title: proposal.title || draft.title,
    subtitle: proposal.subtitles.join('\n'),
    summary: proposal.summary,
    body_html: proposal.body_html || draft.body_html,
    tags: proposal.tags,
    model: route.model,
    provider: route.provider,
    tier: route.tier,
    input_tokens: Number(usage?.input_tokens || reserved.input_tokens || 0),
    output_tokens: Number(usage?.output_tokens || reserved.output_tokens || 0),
    estimated_cost_usd: reserved.estimated_cost_usd,
    prompt,
    validation: review,
  });
  const usageEvent = await recordAiUsage(supabase, { draftId: id, route, scope, reserved, usage, status: 'succeeded' });
  const { error: draftError } = await supabase.from('editorial_drafts').update({
    ai_prompt: prompt || null,
    ai_generated_at: new Date().toISOString(),
    ai_generation_status: 'ready',
    ai_generation_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (draftError) throw draftError;
  return res.status(200).json({ proposal, model: route.model, provider: route.provider, tier: route.tier, usage: usageEvent, validation, review });
}

async function insertAiDraftVersion(supabase, version) {
  let { error } = await supabase.from('editorial_draft_versions').insert(version);
  if (!error) return;
  if (!/provider|tier|input_tokens|output_tokens|estimated_cost_usd/i.test(String(error.message || ''))) throw error;
  const legacy = { ...version };
  delete legacy.provider;
  delete legacy.tier;
  delete legacy.input_tokens;
  delete legacy.output_tokens;
  delete legacy.estimated_cost_usd;
  ({ error } = await supabase.from('editorial_draft_versions').insert(legacy));
  if (error) throw error;
}

async function verifyBriefSummary(req, res) {
  const clusterId = Number.parseInt(req.body?.eventClusterId, 10);
  if (!clusterId) return res.status(400).json({ error: 'eventClusterId is required' });
  const supabase = getSupabase();
  const [{ data: cluster, error: clusterError }, { data: articles, error: articleError }, { data: facts, error: factError }] = await Promise.all([
    supabase.from('event_clusters').select('*').eq('id', clusterId).single(),
    supabase.from('raw_articles').select('title,url,summary,published_at,source_domain,source_type,source_layer,authority_score,quality_score,verification_status').eq('event_cluster_id', clusterId).order('quality_score', { ascending: false }),
    supabase.from('article_facts').select('fact_text,fact_type,source_url,is_official,confidence').eq('event_cluster_id', clusterId).order('confidence', { ascending: false }),
  ]);
  if (clusterError) throw clusterError;
  if (articleError) throw articleError;
  if (factError) throw factError;
  const sortedArticles = sortEvidence(articles || []);
  const validation = validateBriefForPreparation(cluster, sortedArticles, facts || []);
  const digest = buildBriefDigest(cluster, sortedArticles, facts || [], validation);
  if (!digest.summary) return res.status(409).json({ error: '검증할 요약이 없습니다.' });
  const context = buildEvidence(cluster, sortedArticles, facts || []);
  const route = resolveEditorialAiRoute({ tier: req.body?.tier || 'basic' });
  const reserved = await reserveAiBudget(supabase, {
    draftId: null,
    route,
    context: { digest, evidence: context.evidence },
    scope: 'brief_summary',
  });
  try {
    const { review, usage } = await generateBriefSummaryReview(route, { digest, context });
    const stored = {
      ...review,
      summary_hash: summaryHash(digest.summary),
      reviewed_at: new Date().toISOString(),
      model: route.model,
      provider: route.provider,
    };
    const snapshot = cluster.validation_snapshot && typeof cluster.validation_snapshot === 'object'
      ? { ...cluster.validation_snapshot, ai_summary_review: stored }
      : { ai_summary_review: stored };
    const { error: snapshotError } = await supabase.from('event_clusters').update({ validation_snapshot: snapshot }).eq('id', clusterId);
    if (snapshotError && !isMissingBriefMetadata(snapshotError)) throw snapshotError;
    const usageEvent = await recordAiUsage(supabase, {
      draftId: null,
      route,
      scope: 'brief_summary',
      reserved,
      usage,
      status: 'succeeded',
    });
    return res.status(200).json({
      review: stored,
      decision: classifyAfterAiReview(validation, sortedArticles, stored),
      digest: { title: digest.title, summary: digest.summary },
      model: route.model,
      provider: route.provider,
      usage: usageEvent,
    });
  } catch (err) {
    await recordAiUsage(supabase, {
      draftId: null,
      route,
      scope: 'brief_summary',
      reserved,
      status: 'failed',
      errorMessage: err.message,
    });
    throw err;
  }
}

async function verifyDraftEvidence(req, res) {
  const id = Number.parseInt(req.body?.id, 10);
  if (!id) return res.status(400).json({ error: 'id is required' });
  const supabase = getSupabase();
  const { draft, cluster, articles, facts } = await loadDraftAiContext(supabase, id);
  const context = buildEvidence(cluster, articles, facts);
  const currentDraft = requestedDraftSnapshot(req.body?.draft, draft);
  return res.status(200).json({
    review: reviewDraftEvidence(currentDraft, context.urls),
    validation: validateBriefForPreparation(cluster, articles, facts),
  });
}

async function generateDraftImage(req, res) {
  const id = Number.parseInt(req.body?.id, 10);
  if (!id) return res.status(400).json({ error: 'id is required' });
  const supabase = getSupabase();
  const schemaError = await ensureAiSchema(supabase);
  if (schemaError) return res.status(409).json({ error: 'AI 이미지 데이터베이스 마이그레이션 적용이 필요합니다.' });
  const { draft } = await loadDraftAiContext(supabase, id);
  if (!['draft', 'rejected'].includes(draft.status)) return res.status(409).json({ error: '검토 대기 또는 승인된 초안은 AI 이미지를 생성할 수 없습니다.' });
  const model = resolveOpenAIImageModel(req.body?.model);
  const prompt = buildImagePrompt({ ...draft, ...requestedDraftSnapshot(req.body?.draft, draft) }, req.body?.prompt);
  await supabase.from('editorial_drafts').update({ ai_generation_status: 'generating', ai_generation_error: null }).eq('id', id);
  try {
    const image = await getOpenAI().images.generate({
      model,
      prompt,
      size: '1536x1024',
      quality: 'medium',
      output_format: 'jpeg',
    });
    const base64 = image.data?.[0]?.b64_json;
    if (!base64) throw new Error('AI image response did not include image data.');
    const path = `draft-${id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
    const { error: uploadError } = await supabase.storage.from('editorial-assets').upload(path, Buffer.from(base64, 'base64'), { contentType: 'image/jpeg', upsert: false });
    if (uploadError) throw uploadError;
    const { data: asset, error: assetError } = await supabase.from('editorial_assets').insert({
      draft_id: id,
      kind: 'representative_image',
      storage_path: path,
      mime_type: 'image/jpeg',
      width: 1536,
      height: 1024,
      alt_text: String(req.body?.thumbnailAlt || '').trim().slice(0, 300) || null,
      caption: String(req.body?.thumbnailCaption || '').trim().slice(0, 300) || null,
      source: 'AI generated',
      prompt,
      model,
    }).select().single();
    if (assetError) throw assetError;
    const { error: updateError } = await supabase.from('editorial_drafts').update({
      latest_image_asset_id: asset.id,
      ai_prompt: prompt,
      ai_generated_at: new Date().toISOString(),
      ai_generation_status: 'ready',
      ai_generation_error: null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (updateError) throw updateError;
    const { data: signed, error: signedError } = await supabase.storage.from('editorial-assets').createSignedUrl(path, 3600);
    if (signedError) throw signedError;
    return res.status(201).json({ asset: { ...asset, url: signed.signedUrl } });
  } catch (err) {
    await supabase.from('editorial_drafts').update({ ai_generation_status: 'failed', ai_generation_error: String(err.message || err).slice(0, 1000) }).eq('id', id);
    throw err;
  }
}

async function loadDraftAiContext(supabase, id) {
  const { data: draft, error: draftError } = await supabase.from('editorial_drafts').select('*').eq('id', id).single();
  if (draftError) throw draftError;
  const [{ data: cluster, error: clusterError }, { data: articles, error: articleError }, { data: facts, error: factError }] = await Promise.all([
    supabase.from('event_clusters').select('*').eq('id', draft.event_cluster_id).single(),
    supabase.from('raw_articles').select('title,url,summary,published_at,source,source_domain,source_type,source_layer,authority_score,quality_score,verification_status').eq('event_cluster_id', draft.event_cluster_id).order('quality_score', { ascending: false }),
    supabase.from('article_facts').select('fact_text,fact_type,source_url,is_official,confidence').eq('event_cluster_id', draft.event_cluster_id).order('confidence', { ascending: false }),
  ]);
  if (clusterError) throw clusterError;
  if (articleError) throw articleError;
  if (factError) throw factError;
  return { draft, cluster, articles: articles || [], facts: facts || [] };
}

function requestedDraftSnapshot(input, draft) {
  return {
    title: String(input?.title ?? draft.title ?? '').slice(0, 500),
    subtitle: String(input?.subtitle ?? draft.subtitle ?? '').slice(0, 1000),
    summary: String(input?.summary ?? draft.summary ?? '').slice(0, 1800),
    body_html: sanitizeArticleHtml(input?.bodyHtml ?? draft.body_html ?? ''),
    tags: Array.isArray(input?.tags) ? input.tags.slice(0, 20) : (draft.tags || []),
  };
}

async function ensureAiSchema(supabase) {
  const { error } = await supabase.from('editorial_draft_versions').select('id').limit(1);
  return error || null;
}

async function attachDraftAssets(supabase, drafts) {
  const assetIds = drafts.map((draft) => draft.latest_image_asset_id).filter(Boolean);
  if (!assetIds.length) return drafts;
  const { data: assets, error } = await supabase.from('editorial_assets').select('*').in('id', assetIds);
  if (error) return drafts;
  const byId = new Map((assets || []).map((asset) => [asset.id, asset]));
  return Promise.all(drafts.map(async (draft) => {
    const asset = byId.get(draft.latest_image_asset_id);
    if (!asset) return draft;
    const { data } = await supabase.storage.from('editorial-assets').createSignedUrl(asset.storage_path, 3600);
    return { ...draft, image_asset: { ...asset, url: data?.signedUrl || null } };
  }));
}

function validateBriefForPreparation(cluster, articles, facts) {
  return evaluateBriefPolicy(cluster, articles || [], facts || []);
}

function buildArticleStarter(cluster, articles, facts, digestInput) {
  const digest = digestInput || buildBriefDigest(cluster, articles, facts);
  const primarySource = articles[0] || {};
  const highlightItems = digest.highlights.length
    ? digest.highlights.map((row) => `<li><strong>${escapeHtml(row.label)}</strong> ${escapeHtml(row.value)}${row.detail ? ` (${escapeHtml(row.detail)})` : ''}</li>`).join('')
    : '<li>구조화 사실 없음 — 근거 기사 원문에서 핵심 사실을 확인하세요.</li>';
  const referenceItems = digest.sources
    .filter((article) => article.url)
    .map((article) => `<li><a href="${escapeHtml(article.url)}">${escapeHtml(article.label || article.title || article.url)}</a></li>`)
    .join('');
  return {
    title: String(digest.title || cluster.representative_title || '').slice(0, 500),
    summary: digest.summary.slice(0, 1600),
    bodyHtml: [
      '<h3>소재 요약</h3>',
      `<p>${escapeHtml(digest.summary || primarySource.summary || '근거 기사 내용을 토대로 완성된 기사 본문을 작성하세요.')}</p>`,
      '<h3>핵심</h3>',
      `<ul>${highlightItems}</ul>`,
      '<h3>참고자료</h3>',
      `<ul>${referenceItems || '<li>근거 URL 없음</li>'}</ul>`,
    ].join('\n'),
    tags: mapPlatformCategory(cluster.category).tags,
    primarySource,
  };
}

async function updateEditorialDraft(supabase, id, updates) {
  const updated = await supabase.from('editorial_drafts').update(updates).eq('id', id).select().single();
  if (!updated.error || !/platform_category_id|additional_category_1|source_url/.test(updated.error.message || '')) {
    return updated;
  }
  const fallback = { ...updates };
  delete fallback.platform_category_id;
  delete fallback.additional_category_1;
  delete fallback.additional_category_2;
  delete fallback.source_url;
  return supabase.from('editorial_drafts').update(fallback).eq('id', id).select().single();
}

async function insertEditorialDraft(supabase, row) {
  const inserted = await supabase.from('editorial_drafts').insert(row).select().single();
  if (!inserted.error || !/platform_category_id|additional_category_1|source_url/.test(inserted.error.message || '')) {
    return inserted;
  }
  const fallback = { ...row };
  delete fallback.platform_category_id;
  delete fallback.additional_category_1;
  delete fallback.additional_category_2;
  delete fallback.source_url;
  return supabase.from('editorial_drafts').insert(fallback).select().single();
}

async function attachDraftClassification(supabase, drafts) {
  const clusterIds = [...new Set(drafts.map((draft) => draft.event_cluster_id).filter(Boolean))];
  const categories = new Map();
  if (clusterIds.length) {
    const { data, error } = await supabase.from('event_clusters').select('id,category').in('id', clusterIds);
    if (!error) {
      for (const cluster of data || []) categories.set(cluster.id, cluster.category);
    }
  }
  return drafts.map((draft) => ({
    ...draft,
    cluster_category: categories.get(draft.event_cluster_id) || null,
    classification: classificationFromDraft(draft, categories.get(draft.event_cluster_id)),
  }));
}

function summarizeBrief(cluster, articles, facts) {
  const officialSourceCount = articles.filter((article) => article.source_type === 'official').length;
  const independentSources = independentSourceCount(articles);
  const normalizedCluster = {
    ...cluster,
    official_source_count: Math.max(Number(cluster.official_source_count || 0), officialSourceCount),
    independent_source_count: independentSources,
  };
  const validation = validateBriefForPreparation(normalizedCluster, articles, facts);
  const digest = buildBriefDigest(normalizedCluster, articles, facts, validation);
  const aiReview = attachStoredReview(normalizedCluster, digest);
  applyReviewToDigest(digest, validation, articles, aiReview);
  const sourceLayers = [...new Set(articles.map((article) => article.source_layer).filter(Boolean))];
  const maxQuality = articles.reduce((max, article) => Math.max(max, Number(article.quality_score || 0)), 0);
  const stage = validation.stage === 'blocked' ? 'blocked' : digest.decision.allowed ? 'ready' : 'reviewable';
  return {
    ...normalizedCluster,
    fact_count: facts.length,
    numeric_fact_count: facts.filter((fact) => fact.fact_type === 'number').length,
    source_layers: sourceLayers,
    max_quality_score: maxQuality,
    preparation_ready: digest.decision.allowed,
    validation_stage: stage,
    source_grades: validation.source_grades,
    blocker: digest.decision.allowed ? null : digest.decision.reason,
    digest: {
      title: digest.title,
      summary: digest.summary,
      preview: digest.preview,
      decision: digest.decision,
    },
    aiReview,
    system_status: cluster.status === 'archived'
      ? 'archived'
      : stage === 'ready'
        ? 'ready'
        : stage === 'reviewable'
          ? 'reviewable'
          : 'needs_verification',
  };
}

function independentSourceCount(articles) {
  return new Set((articles || []).map((article) => article.source_domain).filter(Boolean)).size;
}

function sortEvidence(articles) {
  return [...articles].map((article) => ({ ...article, source_grade: gradeSource(article) })).sort((left, right) => {
    const leftRank = sourceGradeRank(left);
    const rightRank = sourceGradeRank(right);
    if (rightRank !== leftRank) return rightRank - leftRank;
    if (Number(right.quality_score || 0) !== Number(left.quality_score || 0)) {
      return Number(right.quality_score || 0) - Number(left.quality_score || 0);
    }
    return Date.parse(right.published_at || right.collected_at || 0) - Date.parse(left.published_at || left.collected_at || 0);
  });
}

function sortBriefs(briefs, sort) {
  return [...briefs].sort((left, right) => {
    if (sort === 'latest') return Date.parse(right.last_seen_at || 0) - Date.parse(left.last_seen_at || 0);
    if (sort === 'quality') return right.max_quality_score - left.max_quality_score;
    if (sort === 'official') return right.official_source_count - left.official_source_count;
    const stateRank = { unreviewed: 0, reviewing: 1, held: 2, prepared: 3 };
    const leftReady = left.preparation_ready ? 0 : 1;
    const rightReady = right.preparation_ready ? 0 : 1;
    if (left.editorial_state !== right.editorial_state) return stateRank[left.editorial_state] - stateRank[right.editorial_state];
    if (leftReady !== rightReady) return leftReady - rightReady;
    if (Date.parse(right.last_seen_at || 0) !== Date.parse(left.last_seen_at || 0)) {
      return Date.parse(right.last_seen_at || 0) - Date.parse(left.last_seen_at || 0);
    }
    return right.official_source_count - left.official_source_count;
  });
}

function emptyBriefMetrics() {
  return { new_today: 0, ready: 0, needs_verification: 0, held: 0 };
}

function briefMetrics(briefs) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return briefs.reduce((metrics, brief) => {
    if (Date.parse(brief.first_seen_at || 0) >= start.getTime()) metrics.new_today += 1;
    if (brief.preparation_ready) metrics.ready += 1;
    if (!brief.preparation_ready && brief.status !== 'archived') metrics.needs_verification += 1;
    if (brief.editorial_state === 'held') metrics.held += 1;
    return metrics;
  }, emptyBriefMetrics());
}

function collectionHealth(clusters) {
  const timestamps = clusters.map((cluster) => cluster.last_seen_at).filter(Boolean).sort();
  const lastUpdatedAt = timestamps[timestamps.length - 1] || null;
  const ageHours = lastUpdatedAt ? (Date.now() - Date.parse(lastUpdatedAt)) / 3600000 : Number.POSITIVE_INFINITY;
  return {
    last_updated_at: lastUpdatedAt,
    status: ageHours <= 2 ? 'normal' : ageHours <= 24 ? 'delayed' : 'stale',
  };
}

function validateArticleDraft(draft) {
  const problems = [];
  if (!draft?.title?.trim()) problems.push('기사 제목을 입력하세요.');
  if (htmlTextLength(draft?.body_html) < 200) problems.push('기사 본문을 200자 이상 작성하세요.');
  return problems;
}

function htmlTextLength(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));
}

function clamp(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

module.exports.validateBriefForPreparation = validateBriefForPreparation;
module.exports.buildArticleStarter = buildArticleStarter;
module.exports.validateArticleDraft = validateArticleDraft;
