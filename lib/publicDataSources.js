const DATA_GO_KR_BASE = 'https://apis.data.go.kr';

const PUBLIC_DATA_SOURCES = [
  {
    name: '기업마당 API',
    category: 'policy',
    endpoint: `${DATA_GO_KR_BASE}/1421000/bizinfo/pblancBsnsService`,
    paging: { pageParam: 'pageNo', sizeParam: 'numOfRows' },
    includeSummary: false,
  },
  {
    name: 'K-Startup API',
    category: 'startup',
    endpoint: `${DATA_GO_KR_BASE}/B552735/kisedKstartupService01/getAnnouncementInformation01`,
    paging: { pageParam: 'page', sizeParam: 'perPage' },
    includeSummary: true,
  },
];

function getServiceKey() {
  return process.env.DATA_GO_KR_SERVICE_KEY || process.env.PUBLIC_DATA_SERVICE_KEY || '';
}

function findItems(payload) {
  const body = payload?.response?.body || payload?.body || payload;
  const items = body?.items?.item || body?.items || body?.data || body?.item || [];
  return Array.isArray(items) ? items : [items].filter(Boolean);
}

function firstValue(item, keys) {
  for (const key of keys) {
    if (item?.[key]) return String(item[key]).trim();
  }
  return '';
}

function asIso(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00.000Z`;
  }
  const date = new Date(text.replace(/\./g, '-'));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeNotice(source, item) {
  const title = firstValue(item, ['pblancNm', 'bizNm', 'biz_pbanc_nm', 'intg_pbanc_biz_nm', 'title', 'bsnsNm', 'nttSj']);
  const url = firstValue(item, ['pblancUrl', 'detailUrl', 'detl_pg_url', 'url', 'link']);
  if (!title || !/^https?:\/\//i.test(url)) return null;

  return {
    source: source.name,
    category: source.category,
    title,
    url,
    summary: source.includeSummary
      ? firstValue(item, ['bsnsSumryCn', 'bizCn', 'biz_prv_dscn', 'aply_trgt_ctnt', 'contents', 'summary']) || null
      : null,
    published_at: asIso(firstValue(item, ['creatPnttm', 'registDt', 'frstRegisterPnttm', 'pblancDt', 'pbanc_ntce_dt', 'pbanc_rcpt_bgng_dt'])),
  };
}

async function fetchPublicDataNotices(maxPerSource = 20) {
  const serviceKey = getServiceKey();
  if (!serviceKey) return [];

  const notices = [];
  for (const source of PUBLIC_DATA_SOURCES) {
    try {
      const url = new URL(source.endpoint);
      url.searchParams.set('serviceKey', serviceKey);
      url.searchParams.set(source.paging.pageParam, '1');
      url.searchParams.set(source.paging.sizeParam, String(maxPerSource));
      url.searchParams.set('returnType', 'json');

      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('json')) throw new Error('JSON 응답이 아닙니다. 서비스키 승인 상태를 확인하세요.');
      const payload = await response.json();
      notices.push(...findItems(payload).map((item) => normalizeNotice(source, item)).filter(Boolean));
    } catch (err) {
      console.error(`[publicDataSources] ${source.name} 수집 실패:`, err.message);
    }
  }
  return notices;
}

module.exports = { fetchPublicDataNotices, PUBLIC_DATA_SOURCES, getServiceKey, normalizeNotice };
