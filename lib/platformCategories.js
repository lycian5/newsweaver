'use strict';

const PLATFORM_CATEGORY_MAP = Object.freeze({
  ai: { category: '13', additionalCategory1: '16', additionalCategory2: '', tags: ['AI', 'AI비즈니스'] },
  ai_business: { category: '13', additionalCategory1: '16', additionalCategory2: '', tags: ['AI', 'AI비즈니스'] },
  startup: { category: '15', additionalCategory1: '', additionalCategory2: '', tags: ['창업', '부업'] },
  policy: { category: '17', additionalCategory1: '11', additionalCategory2: '', tags: ['소상공인', '정책지원'] },
  small_business_economy: { category: '17', additionalCategory1: '', additionalCategory2: '', tags: ['소상공인'] },
  local_commerce: { category: '12', additionalCategory1: '', additionalCategory2: '', tags: ['지역상권', '전통시장'] },
  marketing_distribution: { category: '18', additionalCategory1: '', additionalCategory2: '', tags: ['마케팅', '유통'] },
  field_issue: { category: '14', additionalCategory1: '', additionalCategory2: '', tags: ['현장', '이슈'] },
  column: { category: '14/26', additionalCategory1: '', additionalCategory2: '', tags: ['칼럼', '인사이트'] },
});

function mapPlatformCategory(internalCategory) {
  const key = String(internalCategory || '').trim();
  const mapped = PLATFORM_CATEGORY_MAP[key];
  if (mapped) return { ...mapped, tags: [...mapped.tags] };
  return { category: '11', additionalCategory1: '', additionalCategory2: '', tags: [] };
}

function classificationFromDraft(draft = {}, clusterCategory) {
  const fallback = mapPlatformCategory(clusterCategory || draft.cluster_category);
  return {
    category: draft.platform_category_id || fallback.category,
    additionalCategory1: draft.additional_category_1 || fallback.additionalCategory1,
    additionalCategory2: draft.additional_category_2 || fallback.additionalCategory2,
    tags: Array.isArray(draft.tags) && draft.tags.length ? draft.tags : fallback.tags,
    sourceUrl: draft.source_url || '',
  };
}

module.exports = {
  PLATFORM_CATEGORY_MAP,
  classificationFromDraft,
  mapPlatformCategory,
};
