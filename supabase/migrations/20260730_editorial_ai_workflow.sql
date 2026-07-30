alter table editorial_drafts
  add column if not exists ai_prompt text,
  add column if not exists ai_generated_at timestamptz,
  add column if not exists ai_generation_status text not null default 'idle'
    check (ai_generation_status in ('idle', 'generating', 'ready', 'failed')),
  add column if not exists ai_generation_error text,
  add column if not exists latest_image_asset_id bigint;

create table if not exists editorial_draft_versions (
  id bigint generated always as identity primary key,
  draft_id bigint not null references editorial_drafts(id) on delete cascade,
  action text not null,
  title text not null,
  subtitle text,
  summary text,
  body_html text not null,
  tags text[] not null default '{}',
  model text,
  prompt text,
  validation jsonb,
  created_at timestamptz not null default now()
);
create index if not exists editorial_draft_versions_draft_idx on editorial_draft_versions(draft_id, created_at desc);

create table if not exists editorial_assets (
  id bigint generated always as identity primary key,
  draft_id bigint not null references editorial_drafts(id) on delete cascade,
  kind text not null check (kind in ('representative_image')),
  storage_path text not null unique,
  mime_type text not null,
  width integer,
  height integer,
  alt_text text,
  caption text,
  source text,
  prompt text,
  model text,
  created_at timestamptz not null default now()
);
create index if not exists editorial_assets_draft_idx on editorial_assets(draft_id, created_at desc);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'editorial_drafts_latest_image_asset_fk') then
    alter table editorial_drafts add constraint editorial_drafts_latest_image_asset_fk foreign key (latest_image_asset_id) references editorial_assets(id) on delete set null;
  end if;
end $$;
insert into storage.buckets (id, name, public) values ('editorial-assets', 'editorial-assets', false) on conflict (id) do nothing;
notify pgrst, 'reload schema';
