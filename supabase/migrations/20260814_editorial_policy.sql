-- Phase 2: staged editorial validation and explicit source grades.

alter table raw_articles
  add column if not exists source_grade text
    check (source_grade in ('A', 'B', 'C', 'D'));

create index if not exists raw_articles_source_grade_idx
  on raw_articles(source_grade, collected_at desc);

alter table event_clusters
  add column if not exists validation_stage text not null default 'reviewable'
    check (validation_stage in ('blocked', 'reviewable', 'ready')),
  add column if not exists validation_checked_at timestamptz,
  add column if not exists validation_snapshot jsonb not null default '{}'::jsonb;

create index if not exists event_clusters_validation_stage_idx
  on event_clusters(validation_stage, last_seen_at desc);

comment on column raw_articles.source_grade is
  'A official/data, B verified/high-authority, C usable secondary, D community/unknown/rejected.';
comment on column event_clusters.validation_stage is
  'blocked lacks minimum evidence; reviewable can enter drafting with warnings; ready meets editorial evidence policy.';
