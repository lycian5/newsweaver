-- COA NEWS 3대 주력 카테고리: 핵심 12개 + 순환 42개
-- 기존 수집 이력은 보존하고, 이전 수동 키워드만 비활성화합니다.
begin;

update tracked_keywords
set status = 'retired'
where status = 'active'
  and added_by = 'manual'
  and category in ('ai_business', 'startup', 'policy');

insert into tracked_keywords (keyword, category, tier, status, datalab_priority, added_by) values
  ('생성형 AI', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('AI 에이전트', 'ai_business', 'seed', 'active', 2, 'manual'),
  ('업무 자동화', 'ai_business', 'seed', 'active', 3, 'manual'),
  ('AI 도입 사례', 'ai_business', 'seed', 'active', 4, 'manual'),
  ('창업 지원', 'startup', 'seed', 'active', 5, 'manual'),
  ('소상공인', 'startup', 'seed', 'active', 6, 'manual'),
  ('1인 기업', 'startup', 'seed', 'active', 7, 'manual'),
  ('온라인 창업', 'startup', 'seed', 'active', 8, 'manual'),
  ('정부지원사업', 'policy', 'seed', 'active', 9, 'manual'),
  ('창업지원금', 'policy', 'seed', 'active', 10, 'manual'),
  ('소상공인 지원', 'policy', 'seed', 'active', 11, 'manual'),
  ('중소기업 지원', 'policy', 'seed', 'active', 12, 'manual'),
  ('LLM', 'ai_business', 'expanded', 'active', 13, 'manual'),
  ('MCP', 'ai_business', 'expanded', 'active', 14, 'manual'),
  ('AI 코딩', 'ai_business', 'expanded', 'active', 15, 'manual'),
  ('노코드 AI', 'ai_business', 'expanded', 'active', 16, 'manual'),
  ('RPA', 'ai_business', 'expanded', 'active', 17, 'manual'),
  ('AI SaaS', 'ai_business', 'expanded', 'active', 18, 'manual'),
  ('AI 마케팅', 'ai_business', 'expanded', 'active', 19, 'manual'),
  ('AI 검색', 'ai_business', 'expanded', 'active', 20, 'manual'),
  ('AI 보안', 'ai_business', 'expanded', 'active', 21, 'manual'),
  ('로컬 AI', 'ai_business', 'expanded', 'active', 22, 'manual'),
  ('AI 영상 제작', 'ai_business', 'expanded', 'active', 23, 'manual'),
  ('AI 이미지 생성', 'ai_business', 'expanded', 'active', 24, 'manual'),
  ('AI 생산성', 'ai_business', 'expanded', 'active', 25, 'manual'),
  ('AI 스타트업', 'ai_business', 'expanded', 'active', 26, 'manual'),
  ('SaaS 창업', 'startup', 'expanded', 'active', 27, 'manual'),
  ('프리랜서', 'startup', 'expanded', 'active', 28, 'manual'),
  ('콘텐츠 수익화', 'startup', 'expanded', 'active', 29, 'manual'),
  ('전자상거래', 'startup', 'expanded', 'active', 30, 'manual'),
  ('스마트스토어', 'startup', 'expanded', 'active', 31, 'manual'),
  ('해외 판매', 'startup', 'expanded', 'active', 32, 'manual'),
  ('B2B SaaS', 'startup', 'expanded', 'active', 33, 'manual'),
  ('유튜브 수익화', 'startup', 'expanded', 'active', 34, 'manual'),
  ('뉴스레터 수익화', 'startup', 'expanded', 'active', 35, 'manual'),
  ('디지털 상품', 'startup', 'expanded', 'active', 36, 'manual'),
  ('배달 창업', 'startup', 'expanded', 'active', 37, 'manual'),
  ('프랜차이즈 창업', 'startup', 'expanded', 'active', 38, 'manual'),
  ('소상공인 디지털 전환', 'startup', 'expanded', 'active', 39, 'manual'),
  ('창업 트렌드', 'startup', 'expanded', 'active', 40, 'manual'),
  ('예비창업패키지', 'policy', 'expanded', 'active', 41, 'manual'),
  ('초기창업패키지', 'policy', 'expanded', 'active', 42, 'manual'),
  ('청년창업', 'policy', 'expanded', 'active', 43, 'manual'),
  ('정책자금', 'policy', 'expanded', 'active', 44, 'manual'),
  ('R&D 지원', 'policy', 'expanded', 'active', 45, 'manual'),
  ('수출지원', 'policy', 'expanded', 'active', 46, 'manual'),
  ('판로지원', 'policy', 'expanded', 'active', 47, 'manual'),
  ('고용지원금', 'policy', 'expanded', 'active', 48, 'manual'),
  ('세제지원', 'policy', 'expanded', 'active', 49, 'manual'),
  ('디지털 전환 지원', 'policy', 'expanded', 'active', 50, 'manual'),
  ('재도전 지원', 'policy', 'expanded', 'active', 51, 'manual'),
  ('지역특화사업', 'policy', 'expanded', 'active', 52, 'manual'),
  ('규제샌드박스', 'policy', 'expanded', 'active', 53, 'manual'),
  ('공공 AI 정책', 'policy', 'expanded', 'active', 54, 'manual')
on conflict (keyword, category) do update
set tier = excluded.tier,
    status = excluded.status,
    datalab_priority = excluded.datalab_priority,
    added_by = excluded.added_by;

commit;
