const { getSupabase } = require('../../lib/supabase');
const {
  assertCronAuth,
  clearDashboardSessionCookie,
  createDashboardSessionCookie,
  verifyDashboardPassword,
  verifyDashboardSession,
} = require('../../lib/cronAuth');
const { getOpenAI } = require('../../lib/openai');
const { resolveOpenAIModel } = require('../../lib/openaiModels');
const { selectHybridKeywords } = require('../../scripts/keyword-selection');

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    subtitle: { type: 'string' },
    summary: { type: 'string' },
    body_html: { type: 'string', minLength: 200, maxLength: 1600 },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'subtitle', 'summary', 'body_html', 'tags'],
  additionalProperties: false,
};

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
    if (req.method === 'GET' && req.query?.view === 'keywords') return listKeywords(req, res);
    if (req.method === 'GET') return listDrafts(req, res);
    if (req.method === 'POST') return generateDraft(req, res);
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
  let query = supabase
    .from('event_clusters')
    .select('id,category,representative_title,event_date,first_seen_at,last_seen_at,article_count,official_source_count,status')
    .order('last_seen_at', { ascending: false })
    .limit(limit);
  if (req.query?.category) query = query.eq('category', req.query.category);
  if (req.query?.status) query = query.eq('status', req.query.status);
  const { data: clusters, error } = await query;
  if (error) throw error;
  const ids = (clusters || []).map((item) => item.id);
  if (!ids.length) return res.status(200).json({ briefs: [] });
  const [{ data: articles, error: articleError }, { data: facts, error: factError }] = await Promise.all([
    supabase.from('raw_articles').select('id,event_cluster_id,title,url,summary,published_at,source_domain,source_type,quality_score,verification_status').in('event_cluster_id', ids).order('quality_score', { ascending: false }),
    supabase.from('article_facts').select('id,event_cluster_id,raw_article_id,fact_text,fact_type,source_url,is_official,confidence,verified_at').in('event_cluster_id', ids).order('confidence', { ascending: false }),
  ]);
  if (articleError) throw articleError;
  if (factError) throw factError;
  res.status(200).json({ briefs: clusters.map((cluster) => ({
    ...cluster,
    articles: (articles || []).filter((item) => item.event_cluster_id === cluster.id),
    facts: (facts || []).filter((item) => item.event_cluster_id === cluster.id),
  })) });
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

async function generateDraft(req, res) {
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
  if (!articles?.length) return res.status(400).json({ error: '근거 기사가 없습니다.' });

  const model = resolveOpenAIModel('draft', req.body?.model);
  const response = await getOpenAI().chat.completions.create({
    model,
    messages: [
      { role: 'system', content: '당신은 코아뉴스 소재 편집 보조입니다. 제공된 근거만 사용해 기사 작성 여부를 판단할 수 있는 짧은 한국어 맥락 요약을 작성하세요. 완성 기사를 쓰지 말고, 무슨 일이 있었는지, 왜 지금 다룰 만한지, 핵심 수치·기관·일자, 추가 확인 사항, 권장 기사 각도를 3~5개 문단이나 목록으로 정리하세요. 확인되지 않은 사실, 가상 인용, 임의 수치를 만들지 마세요. body_html은 200~1600자 범위로 작성하고 p, h3, ul, li 태그만 사용합니다. 출처 간 차이가 있으면 단정하지 말고 확인 필요 사항을 명시하세요.' },
      { role: 'user', content: buildEvidencePrompt(cluster, articles, facts) },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'coanews_editorial_draft', strict: true, schema: DRAFT_SCHEMA } },
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('OpenAI 초안 응답이 비어 있습니다.');
  const draft = JSON.parse(content);
  const row = {
    event_cluster_id: clusterId,
    title: draft.title.slice(0, 500),
    subtitle: draft.subtitle?.slice(0, 500) || null,
    summary: draft.summary?.slice(0, 1500) || null,
    body_html: draft.body_html,
    tags: (draft.tags || []).slice(0, 20),
    status: 'draft',
    model,
  };
  const { data, error } = await supabase.from('editorial_drafts').insert(row).select().single();
  if (error) throw error;
  res.status(201).json({ draft: data });
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
    updates.status = 'pending_editor_approval'; updates.submitted_at = now; updates.decided_at = null;
  } else if (action === 'approve' && current.status === 'pending_editor_approval') {
    updates.status = 'approved'; updates.decided_at = now;
  } else if (action === 'reject' && current.status === 'pending_editor_approval') {
    updates.status = 'rejected'; updates.decided_at = now; updates.editorial_notes = String(req.body?.editorialNotes || '').slice(0, 3000);
  } else {
    return res.status(409).json({ error: `허용되지 않은 상태 전환입니다: ${current.status} -> ${action}` });
  }
  const { data, error } = await supabase.from('editorial_drafts').update(updates).eq('id', id).select().single();
  if (error) throw error;
  res.status(200).json({ draft: data });
}

function buildEvidencePrompt(cluster, articles, facts) {
  const factText = facts.length ? facts.map((f) => `- [${f.fact_type}] ${f.fact_text} | 공식=${f.is_official} | 신뢰=${f.confidence} | ${f.source_url}`).join('\n') : '- 구조화 사실 없음';
  const articleText = articles.map((a) => `- ${a.title}\n  출처: ${a.source_domain} (${a.source_type}, 품질 ${a.quality_score})\n  URL: ${a.url}\n  요약: ${a.summary || '없음'}`).join('\n');
  return `[사건]\n${cluster.representative_title}\n분야: ${cluster.category}\n기준일: ${cluster.event_date || '미상'}\n\n[구조화 사실]\n${factText}\n\n[근거 기사]\n${articleText}`;
}

function clamp(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

module.exports.buildEvidencePrompt = buildEvidencePrompt;
