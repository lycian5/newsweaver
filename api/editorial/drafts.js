const { getSupabase } = require('../../lib/supabase');
const {
  assertCronAuth,
  clearDashboardSessionCookie,
  createDashboardSessionCookie,
  verifyDashboardPassword,
  verifyDashboardSession,
} = require('../../lib/cronAuth');
const { selectHybridKeywords } = require('../../scripts/keyword-selection');

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
    if (req.method === 'GET') return listDrafts(req, res);
    if (req.method === 'POST' && req.body?.action === 'prepare') return prepareArticleDraft(req, res);
    if (req.method === 'POST' && ['start_review', 'hold', 'resume', 'archive'].includes(req.body?.action)) return updateBriefState(req, res);
    if (req.method === 'PATCH') return updateDraft(req, res);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[editorial/drafts]', err.message);
    res.status(500).json({ error: err.message });
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
    .order('datalab_priority', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;

  const selected = selectHybridKeywords(keywords || [], {
    limitKeywords,
    coreKeywordCount,
    rotatingKeywordCount,
    date: new Date(),
  });
  const coreCount = Math.min(coreKeywordCount, selected.length);
  const koreaDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  res.status(200).json({
    date: koreaDate,
    core: selected.slice(0, coreCount),
    rotating: selected.slice(coreCount),
  });
}

async function listBriefs(req, res) {
  const supabase = getSupabase();
  const limit = clamp(req.query?.limit, 1, 100, 100);
  const clusters = await fetchBriefClusters(supabase, req, limit);
  const ids = (clusters || []).map((item) => item.id);
  if (!ids.length) return res.status(200).json({ briefs: [], metrics: emptyBriefMetrics(), collection: collectionHealth([]) });
  const [{ data: articles, error: articleError }, { data: facts, error: factError }] = await Promise.all([
    supabase.from('raw_articles').select('event_cluster_id,url,published_at,source_domain,source_type,source_layer,quality_score,verification_status').in('event_cluster_id', ids),
    supabase.from('article_facts').select('event_cluster_id,fact_type,is_official').in('event_cluster_id', ids),
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
    supabase.from('raw_articles').select('id,event_cluster_id,title,url,summary,published_at,collected_at,source,source_domain,source_type,source_layer,query_stage,quality_score,verification_status').eq('event_cluster_id', clusterId),
    supabase.from('article_facts').select('id,event_cluster_id,raw_article_id,fact_text,fact_type,source_url,is_official,confidence,verified_at,created_at').eq('event_cluster_id', clusterId).order('confidence', { ascending: false }),
  ]);
  if (clusterError) throw clusterError;
  if (articleError) throw articleError;
  if (factError) throw factError;
  const normalizedCluster = normalizeBriefCluster(cluster);
  const sortedArticles = sortEvidence(articles || []);
  const validation = validateBriefForPreparation(normalizedCluster, sortedArticles, facts || []);
  res.status(200).json({
    brief: {
      ...normalizedCluster,
      independent_source_count: independentSourceCount(sortedArticles),
      articles: sortedArticles,
      facts: facts || [],
      validation,
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
    hold: { from: ['reviewing'], updates: { editorial_state: 'held' } },
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
  res.status(200).json({ drafts: data || [] });
}

async function prepareArticleDraft(req, res) {
  const clusterId = Number.parseInt(req.body?.eventClusterId, 10);
  if (!clusterId) return res.status(400).json({ error: 'eventClusterId is required' });
  const supabase = getSupabase();
  const [{ data: cluster, error: clusterError }, { data: articles, error: articleError }, { data: facts, error: factError }] = await Promise.all([
    supabase.from('event_clusters').select('*').eq('id', clusterId).single(),
    supabase.from('raw_articles').select('title,url,summary,source_domain,source_type,quality_score,verification_status').eq('event_cluster_id', clusterId).order('quality_score', { ascending: false }),
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
  if (!validation.ready) return res.status(409).json({ error: validation.blockers[0], validation });

  const starter = buildArticleStarter(cluster, articles, facts);
  const row = {
    event_cluster_id: clusterId,
    title: starter.title,
    subtitle: null,
    summary: starter.summary,
    body_html: starter.bodyHtml,
    tags: starter.tags,
    status: 'draft',
    model: null,
  };
  const { data, error } = await supabase.from('editorial_drafts').insert(row).select().single();
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
      event_cluster_id: clusterId,
      draft_id: data.id,
      references: articles.map((article) => article.url).filter(Boolean),
      facts: facts.map((fact) => ({
        text: fact.fact_text,
        source_url: fact.source_url,
        is_official: fact.is_official,
        confidence: fact.confidence,
      })),
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
    : 'id,category,representative_title,event_date,first_seen_at,last_seen_at,article_count,official_source_count,independent_source_count,editorial_state,prepared_draft_id,status';
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
  return error?.code === '42703' && /independent_source_count|editorial_state|prepared_draft_id/.test(error.message || '');
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
  const { data, error } = await supabase.from('editorial_drafts').update(updates).eq('id', id).select().single();
  if (error) throw error;
  res.status(200).json({ draft: data });
}

function validateBriefForPreparation(cluster, articles, facts) {
  const blockers = [];
  const warnings = [];
  const independentSources = independentSourceCount(articles);
  const factTypes = new Set((facts || []).map((fact) => fact.fact_type));
  const isPolicyBrief = cluster?.category === 'policy';
  const isFresh = isWithinHours(cluster?.last_seen_at, 24);
  if (!cluster?.representative_title?.trim()) blockers.push('대표 제목이 없어 기사 초안을 준비할 수 없습니다.');
  if (!articles?.length) blockers.push('근거 기사가 없어 기사 초안을 준비할 수 없습니다.');
  if (articles?.length && !articles.some((article) => article.url)) blockers.push('사용 가능한 근거 기사 URL이 없습니다.');
  const hasVerifiedSource = articles?.some((article) => article.verification_status === 'verified');
  const hasOfficialSource = Number(cluster?.official_source_count || 0) > 0 || articles?.some((article) => article.source_type === 'official');
  const hasPolicyDate = Boolean(cluster?.event_date) || articles?.some((article) => article.published_at);
  if (!hasVerifiedSource && !hasOfficialSource) blockers.push('공식 또는 검증된 출처가 한 건 이상 필요합니다.');
  if (!isPolicyBrief && independentSources < 2) blockers.push('독립 발행처가 두 곳 이상 필요합니다.');
  if (isPolicyBrief && !hasPolicyDate) blockers.push('정책·지원사업은 공식 원문의 발행일 또는 공고일이 필요합니다.');
  if (!facts?.length && !isPolicyBrief) warnings.push('구조화된 확인 사실이 없습니다. 원문에서 날짜·기관·수치를 다시 확인하세요.');
  if (isPolicyBrief && !factTypes.has('date') && !factTypes.has('organization')) warnings.push('정책·지원사업의 날짜·기관은 공식 원문에서 확인하세요.');
  if (!isPolicyBrief && (!factTypes.has('date') || !factTypes.has('organization') || !factTypes.has('number'))) warnings.push('날짜·기관·수치 사실이 모두 확보되지 않았습니다.');
  if (!hasOfficialSource) warnings.push('공식 출처가 없습니다. 인용 범위와 사실관계를 추가 검토하세요.');
  if (!isFresh) warnings.push('최근 24시간 안에 근거가 갱신되지 않았습니다. 최신성을 다시 확인하세요.');
  return {
    ready: blockers.length === 0,
    checked_at: new Date().toISOString(),
    is_policy: isPolicyBrief,
    blockers,
    warnings,
    checks: {
      title: Boolean(cluster?.representative_title?.trim()),
      evidence: Boolean(articles?.length),
      source_url: Boolean(articles?.some((article) => article.url)),
      verified_source: Boolean(hasVerifiedSource || hasOfficialSource),
      structured_facts: Boolean(facts?.length),
      independent_sources: independentSources >= 2,
      key_facts: isPolicyBrief
        ? hasPolicyDate && hasOfficialSource
        : factTypes.has('date') && factTypes.has('organization') && factTypes.has('number'),
      fresh: isFresh,
    },
  };
}

function buildArticleStarter(cluster, articles, facts) {
  const primarySource = articles[0] || {};
  const factItems = facts.length
    ? facts.map((fact) => `<li>${escapeHtml(fact.fact_text)}</li>`).join('')
    : '<li>구조화 사실 없음 — 근거 기사 원문에서 핵심 사실을 확인하세요.</li>';
  const referenceItems = articles
    .filter((article) => article.url)
    .map((article) => `<li><a href="${escapeHtml(article.url)}">${escapeHtml(article.title || article.url)}</a></li>`)
    .join('');
  const summaryParts = [
    ...facts.map((fact) => fact.fact_text),
    primarySource.summary,
  ].filter(Boolean);
  return {
    title: String(cluster.representative_title || '').slice(0, 500),
    summary: summaryParts.join('\n').slice(0, 1500),
    bodyHtml: [
      '<h3>확인된 사실</h3>',
      `<ul>${factItems}</ul>`,
      '<h3>기사 작성 메모</h3>',
      `<p>${escapeHtml(primarySource.summary || '근거 기사 내용을 토대로 완성된 기사 본문을 작성하세요.')}</p>`,
      '<h3>참고자료</h3>',
      `<ul>${referenceItems}</ul>`,
    ].join('\n'),
    tags: categoryTags(cluster.category),
    primarySource,
  };
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
  const sourceLayers = [...new Set(articles.map((article) => article.source_layer).filter(Boolean))];
  const maxQuality = articles.reduce((max, article) => Math.max(max, Number(article.quality_score || 0)), 0);
  return {
    ...normalizedCluster,
    fact_count: facts.length,
    numeric_fact_count: facts.filter((fact) => fact.fact_type === 'number').length,
    source_layers: sourceLayers,
    max_quality_score: maxQuality,
    preparation_ready: validation.ready,
    blocker: validation.blockers[0] || null,
    system_status: validation.ready ? 'ready' : cluster.status === 'archived' ? 'archived' : 'needs_verification',
  };
}

function independentSourceCount(articles) {
  return new Set((articles || []).map((article) => article.source_domain).filter(Boolean)).size;
}

function sortEvidence(articles) {
  return [...articles].sort((left, right) => {
    const leftRank = sourceRank(left);
    const rightRank = sourceRank(right);
    if (rightRank !== leftRank) return rightRank - leftRank;
    if (Number(right.quality_score || 0) !== Number(left.quality_score || 0)) {
      return Number(right.quality_score || 0) - Number(left.quality_score || 0);
    }
    return Date.parse(right.published_at || right.collected_at || 0) - Date.parse(left.published_at || left.collected_at || 0);
  });
}

function sourceRank(article) {
  if (article.source_type === 'official') return 3;
  if (article.verification_status === 'verified') return 2;
  return 1;
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

function isWithinHours(value, hours) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) && Date.now() - time <= hours * 3600000;
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

function categoryTags(category) {
  return {
    ai_business: ['AI', 'AI비즈니스'],
    startup: ['창업', '부업'],
    policy: ['소상공인', '정책지원'],
  }[category] || [];
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
