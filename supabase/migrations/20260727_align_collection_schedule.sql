-- Align the existing Agent Reach schedule with the documented 16:30 KST run.
alter table if exists collection_schedules
  alter column daily_time set default '16:30';

insert into collection_schedules (key, enabled, daily_time, timezone, updated_at)
values ('agent_reach', true, '16:30', 'Asia/Seoul', now())
on conflict (key) do update set
  enabled = excluded.enabled,
  daily_time = excluded.daily_time,
  timezone = excluded.timezone,
  updated_at = now();
