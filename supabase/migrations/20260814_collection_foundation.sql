-- Phase 1: auditable free collection normalization, funnel metrics, and cluster matching.

create table if not exists collection_runs (
  id uuid primary key,
  collector text not null,
  trigger text not null default 'manual',
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'partial', 'failed')),
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

create index if not exists collection_runs_started_at_idx
  on collection_runs(started_at desc);
create index if not exists collection_runs_status_idx
  on collection_runs(status, started_at desc);

alter table collection_runs enable row level security;

alter table raw_articles
  add column if not exists normalized_title text,
  add column if not exists url_hash text,
  add column if not exists title_hash text,
  add column if not exists content_fingerprint text,
  add column if not exists discovery_channel text,
  add column if not exists publisher_name text,
  add column if not exists cluster_match_method text
    check (cluster_match_method in ('created', 'fingerprint', 'title_date')),
  add column if not exists cluster_match_score numeric(5,4)
    check (cluster_match_score between 0 and 1);

create index if not exists raw_articles_url_hash_idx on raw_articles(url_hash);
create index if not exists raw_articles_title_hash_idx on raw_articles(title_hash);
create index if not exists raw_articles_content_fingerprint_idx on raw_articles(content_fingerprint);
create index if not exists raw_articles_normalized_title_idx on raw_articles(normalized_title);

-- Existing rows remain valid. The next collector/backfill pass fills the new metadata.
