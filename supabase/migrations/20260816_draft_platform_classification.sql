alter table editorial_drafts
  add column if not exists platform_category_id text,
  add column if not exists additional_category_1 text,
  add column if not exists additional_category_2 text,
  add column if not exists source_url text;

comment on column editorial_drafts.platform_category_id is
  'Newspaper platform category id derived from the research brief taxonomy.';
