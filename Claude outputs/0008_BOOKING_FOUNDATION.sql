-- ServiceOS — 0008: booking foundation (Track C)
--
-- Запусти один раз в SQL Editor проекта Supabase (Frankfurt).
-- Тот же файл лежит в репозитории: supabase/migrations/0008_booking_foundation.sql
--
--   1. специалисты (staff_profiles) внутри одного воркспейса различаются по имени,
--      поэтому активные имена должны быть уникальны;
--   2. одна строка рабочих часов по умолчанию на каждый день недели;
--   3. защита на уровне БД от двойной записи одного специалиста на пересекающееся
--      время (приложение проверяет заранее, а это гарантирует, что два одновременных
--      запроса не пройдут оба).

create extension if not exists btree_gist;

create unique index if not exists idx_staff_workspace_active_name
  on staff_profiles (workspace_id, lower(name))
  where active;

create unique index if not exists idx_working_hours_default_weekday
  on working_hours (workspace_id, weekday)
  where staff_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'appointments_no_staff_overlap'
  ) then
    alter table appointments
      add constraint appointments_no_staff_overlap
      exclude using gist (
        staff_id with =,
        tstzrange(starts_at, ends_at) with &&
      )
      where (staff_id is not null and status not in ('cancelled', 'no_show', 'rescheduled'));
  end if;
end
$$;
