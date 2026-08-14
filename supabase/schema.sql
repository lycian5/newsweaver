-- 코아뉴스 키워드 전략 기획서 4.4절 스키마 (Postgres/Supabase)
-- Supabase 대시보드 → SQL Editor 에서 전체를 한 번 실행하세요.

create table if not exists tracked_keywords (
  id bigint generated always as identity primary key,
  keyword text not null,
  category text not null check (category in ('ai_business', 'startup', 'policy', 'small_business_economy', 'local_commerce', 'marketing_distribution', 'field_issue')),
  tier text not null default 'seed' check (tier in ('seed', 'expanded', 'issue')),
  status text not null default 'active' check (status in ('active', 'retired')),
  datalab_priority int not null default 3,
  last_article_at timestamptz,
  added_by text not null default 'manual' check (added_by in ('manual', 'auto_weekly', 'auto_rising')),
  created_at timestamptz not null default now(),
  unique (keyword, category)
);

create table if not exists raw_articles (
  id bigint generated always as identity primary key,
  keyword_id bigint references tracked_keywords(id) on delete set null,
  category text not null check (category in ('ai_business', 'startup', 'policy', 'small_business_economy', 'local_commerce', 'marketing_distribution', 'field_issue')),
  source text not null,
  title text not null,
  url text not null unique,
  summary text,
  published_at timestamptz,
  collected_at timestamptz not null default now(),
  canonical_url text,
  source_domain text,
  source_type text not null default 'media' check (source_type in ('official', 'media', 'community', 'video', 'repository', 'unknown')),
  authority_score smallint not null default 40 check (authority_score between 0 and 100),
  evidence_score smallint not null default 0 check (evidence_score between 0 and 100),
  quality_score smallint not null default 0 check (quality_score between 0 and 100),
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'needs_verification', 'verified', 'rejected')),
  source_grade text check (source_grade in ('A', 'B', 'C', 'D')),
  query_stage text not null default 'explore' check (query_stage in ('explore', 'precision', 'verification')),
  source_layer text not null default 'signal' check (source_layer in ('signal', 'official', 'data')),
  event_fingerprint text,
  normalized_title text,
  url_hash text,
  title_hash text,
  content_fingerprint text,
  discovery_channel text,
  publisher_name text,
  cluster_match_method text check (cluster_match_method in ('created', 'fingerprint', 'title_date')),
  cluster_match_score numeric(5,4) check (cluster_match_score between 0 and 1),
  last_checked_at timestamptz not null default now()
);

create index if not exists raw_articles_keyword_id_idx on raw_articles(keyword_id);
create index if not exists raw_articles_collected_at_idx on raw_articles(collected_at);
create index if not exists raw_articles_category_idx on raw_articles(category);
create index if not exists raw_articles_canonical_url_idx on raw_articles(canonical_url);
create index if not exists raw_articles_event_fingerprint_idx on raw_articles(event_fingerprint);
create index if not exists raw_articles_quality_score_idx on raw_articles(quality_score desc);
create index if not exists raw_articles_verification_status_idx on raw_articles(verification_status);
create index if not exists raw_articles_source_grade_idx on raw_articles(source_grade, collected_at desc);
create index if not exists raw_articles_query_stage_idx on raw_articles(query_stage);
create index if not exists raw_articles_source_layer_idx on raw_articles(source_layer);
create index if not exists raw_articles_url_hash_idx on raw_articles(url_hash);
create index if not exists raw_articles_title_hash_idx on raw_articles(title_hash);
create index if not exists raw_articles_content_fingerprint_idx on raw_articles(content_fingerprint);
create index if not exists raw_articles_normalized_title_idx on raw_articles(normalized_title);

create table if not exists event_clusters (
  id bigint generated always as identity primary key,
  fingerprint text not null unique,
  category text not null check (category in ('ai_business', 'startup', 'policy', 'small_business_economy', 'local_commerce', 'marketing_distribution', 'field_issue')),
  representative_title text not null,
  event_date date,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  article_count int not null default 1,
  official_source_count int not null default 0,
  independent_source_count int not null default 0 check (independent_source_count >= 0),
  editorial_state text not null default 'unreviewed' check (editorial_state in ('unreviewed', 'reviewing', 'held', 'prepared')),
  validation_stage text not null default 'reviewable' check (validation_stage in ('blocked', 'reviewable', 'ready')),
  validation_checked_at timestamptz,
  validation_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'developing' check (status in ('developing', 'ready', 'archived'))
);

alter table raw_articles
  add column if not exists event_cluster_id bigint references event_clusters(id) on delete set null;

create index if not exists raw_articles_event_cluster_idx on raw_articles(event_cluster_id);

create table if not exists article_facts (
  id bigint generated always as identity primary key,
  event_cluster_id bigint references event_clusters(id) on delete cascade,
  raw_article_id bigint references raw_articles(id) on delete cascade,
  fact_text text not null,
  fact_type text not null default 'claim' check (fact_type in ('claim', 'date', 'person', 'organization', 'location', 'number', 'quote')),
  source_url text not null,
  is_official boolean not null default false,
  confidence numeric(4,3) not null default 0.500 check (confidence between 0 and 1),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (raw_article_id, fact_text)
);

create index if not exists article_facts_cluster_idx on article_facts(event_cluster_id);
create index if not exists article_facts_article_idx on article_facts(raw_article_id);

create table if not exists editorial_drafts (
  id bigint generated always as identity primary key,
  event_cluster_id bigint not null references event_clusters(id) on delete cascade,
  title text not null,
  subtitle text,
  summary text,
  body_html text not null,
  tags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'pending_editor_approval', 'approved', 'rejected')),
  model text,
  editorial_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  decided_at timestamptz
);

create index if not exists editorial_drafts_status_idx on editorial_drafts(status, updated_at desc);
create index if not exists editorial_drafts_cluster_idx on editorial_drafts(event_cluster_id, created_at desc);

alter table event_clusters
  add column if not exists prepared_draft_id bigint references editorial_drafts(id) on delete set null;

create index if not exists event_clusters_editorial_state_idx
  on event_clusters(editorial_state, last_seen_at desc);
create index if not exists event_clusters_validation_stage_idx
  on event_clusters(validation_stage, last_seen_at desc);

create table if not exists topic_suggestions (
  id bigint generated always as identity primary key,
  suggested_date date not null default current_date,
  category text not null,
  format text not null check (format in ('article', 'column', 'interview')),
  title text not null,
  angle text,
  keywords text[],
  reference_headlines text[],
  quadrant text,
  interviewee text,
  created_at timestamptz not null default now()
);

create index if not exists topic_suggestions_date_idx on topic_suggestions(suggested_date);

create index if not exists tracked_keywords_category_status_idx on tracked_keywords(category, status);

create table if not exists collection_runs (
  id uuid primary key,
  collector text not null,
  trigger text not null default 'manual',
  status text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  sources text[] not null default '{}',
  keywords_processed int not null default 0 check (keywords_processed >= 0),
  discovered_count int not null default 0 check (discovered_count >= 0),
  normalized_count int not null default 0 check (normalized_count >= 0),
  unique_count int not null default 0 check (unique_count >= 0),
  stored_count int not null default 0 check (stored_count >= 0),
  clustered_article_count int not null default 0 check (clustered_article_count >= 0),
  clusters_created_count int not null default 0 check (clusters_created_count >= 0),
  clusters_updated_count int not null default 0 check (clusters_updated_count >= 0),
  ready_brief_count int not null default 0 check (ready_brief_count >= 0),
  fact_count int not null default 0 check (fact_count >= 0),
  rejection_counts jsonb not null default '{}'::jsonb,
  source_failures jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists collection_runs_started_at_idx on collection_runs(started_at desc);
create index if not exists collection_runs_status_idx on collection_runs(status, started_at desc);

create table if not exists collection_schedules (
  key text primary key check (key = 'agent_reach'),
  enabled boolean not null default true,
  daily_time time not null default '16:30',
  timezone text not null default 'Asia/Seoul' check (timezone = 'Asia/Seoul'),
  updated_at timestamptz not null default now()
);

insert into collection_schedules (key, enabled, daily_time, timezone)
values ('agent_reach', true, '16:30', 'Asia/Seoul')
on conflict (key) do nothing;

-- ── 시드 키워드 54개 (docs/index.html의 QUICK_KEYWORDS와 동일) ──────────────
insert into tracked_keywords (keyword, category, tier, status, datalab_priority, added_by) values
  ('생성형 AI', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('AI 에이전트', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('챗GPT', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('클로드(Claude)', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('제미나이', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('AI 자동화', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('업무 자동화', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('AI 도입 사례', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('AI 생산성', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('LLM', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('AI 스타트업', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('AI 마케팅', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('AI 챗봇', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('노코드', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('RPA', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('AI 반도체', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('온디바이스 AI', 'ai_business', 'seed', 'active', 1, 'manual'),
  ('AI 규제', 'ai_business', 'seed', 'active', 1, 'manual'),

  ('창업', 'startup', 'seed', 'active', 2, 'manual'),
  ('부업', 'startup', 'seed', 'active', 2, 'manual'),
  ('N잡', 'startup', 'seed', 'active', 2, 'manual'),
  ('사이드잡', 'startup', 'seed', 'active', 2, 'manual'),
  ('온라인 수익화', 'startup', 'seed', 'active', 2, 'manual'),
  ('스마트스토어', 'startup', 'seed', 'active', 2, 'manual'),
  ('1인 기업', 'startup', 'seed', 'active', 2, 'manual'),
  ('무자본 창업', 'startup', 'seed', 'active', 2, 'manual'),
  ('프랜차이즈 창업', 'startup', 'seed', 'active', 2, 'manual'),
  ('배달 창업', 'startup', 'seed', 'active', 2, 'manual'),
  ('유튜브 수익', 'startup', 'seed', 'active', 2, 'manual'),
  ('블로그 수익', 'startup', 'seed', 'active', 2, 'manual'),
  ('전자책 판매', 'startup', 'seed', 'active', 2, 'manual'),
  ('구매대행', 'startup', 'seed', 'active', 2, 'manual'),
  ('해외구매대행', 'startup', 'seed', 'active', 2, 'manual'),
  ('공유오피스', 'startup', 'seed', 'active', 2, 'manual'),
  ('폐업', 'startup', 'seed', 'active', 2, 'manual'),
  ('재창업', 'startup', 'seed', 'active', 2, 'manual'),

  ('정부지원사업', 'policy', 'seed', 'active', 1, 'manual'),
  ('소상공인 지원', 'policy', 'seed', 'active', 1, 'manual'),
  ('창업지원금', 'policy', 'seed', 'active', 1, 'manual'),
  ('중소기업 지원', 'policy', 'seed', 'active', 1, 'manual'),
  ('예비창업패키지', 'policy', 'seed', 'active', 1, 'manual'),
  ('초기창업패키지', 'policy', 'seed', 'active', 1, 'manual'),
  ('청년창업', 'policy', 'seed', 'active', 1, 'manual'),
  ('청년정책', 'policy', 'seed', 'active', 1, 'manual'),
  ('고용지원금', 'policy', 'seed', 'active', 1, 'manual'),
  ('바우처 사업', 'policy', 'seed', 'active', 1, 'manual'),
  ('K-스타트업', 'policy', 'seed', 'active', 1, 'manual'),
  ('기업마당', 'policy', 'seed', 'active', 1, 'manual'),
  ('정책자금', 'policy', 'seed', 'active', 1, 'manual'),
  ('소상공인 대출', 'policy', 'seed', 'active', 1, 'manual'),
  ('재난지원', 'policy', 'seed', 'active', 1, 'manual'),
  ('세제 혜택', 'policy', 'seed', 'active', 1, 'manual'),
  ('중소벤처기업부', 'policy', 'seed', 'active', 1, 'manual'),
  ('고용노동부', 'policy', 'seed', 'active', 1, 'manual')
on conflict (keyword, category) do nothing;
