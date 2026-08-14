create table if not exists model_prices (
  id bigint generated always as identity primary key,
  provider text not null,
  model text not null,
  input_per_million_usd numeric(12,6) not null default 0,
  output_per_million_usd numeric(12,6) not null default 0,
  fixed_cost_usd numeric(12,6) not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (provider, model)
);

create table if not exists ai_usage_events (
  id bigint generated always as identity primary key,
  draft_id bigint references editorial_drafts(id) on delete set null,
  provider text not null,
  model text not null,
  tier text not null check (tier in ('basic', 'advanced')),
  request_type text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  status text not null check (status in ('succeeded', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_events_created_at_idx on ai_usage_events(created_at desc);
create index if not exists ai_usage_events_draft_idx on ai_usage_events(draft_id, created_at desc);

alter table model_prices enable row level security;
alter table ai_usage_events enable row level security;

alter table editorial_draft_versions
  add column if not exists provider text,
  add column if not exists tier text,
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer,
  add column if not exists estimated_cost_usd numeric(12,6);

insert into model_prices (provider, model) values
  ('openai', 'gpt-5-mini'),
  ('openai', 'gpt-5.4-mini'),
  ('anthropic', 'claude-sonnet-5'),
  ('xai', 'grok-4.5')
on conflict (provider, model) do nothing;

notify pgrst, 'reload schema';
