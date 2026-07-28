alter table event_clusters
  add column if not exists editorial_state text not null default 'unreviewed'
    check (editorial_state in ('unreviewed', 'reviewing', 'held', 'prepared')),
  add column if not exists independent_source_count int not null default 0
    check (independent_source_count >= 0),
  add column if not exists prepared_draft_id bigint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'event_clusters_prepared_draft_id_fkey'
  ) then
    alter table event_clusters
      add constraint event_clusters_prepared_draft_id_fkey
      foreign key (prepared_draft_id) references editorial_drafts(id) on delete set null;
  end if;
end $$;

create index if not exists event_clusters_editorial_state_idx
  on event_clusters(editorial_state, last_seen_at desc);
