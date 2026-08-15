alter table collection_runs
  add column if not exists collection_mode text,
  add column if not exists target_date date,
  add column if not exists window_start_at timestamptz,
  add column if not exists window_end_at timestamptz,
  add column if not exists recovery_reason text;

create index if not exists collection_runs_mode_target_idx
  on collection_runs(collection_mode, target_date, started_at desc);

comment on column collection_runs.collection_mode is
  'Collection scope: previous_day, previous_day_recovery, all, or a collector-specific mode.';
comment on column collection_runs.target_date is
  'Korea calendar date whose published materials were targeted by the run.';
