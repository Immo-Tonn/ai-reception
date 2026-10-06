-- ServiceOS — 0008: booking foundation (Track C)
--
-- Prepares the schema for real, Supabase-backed online booking:
--   1. specialists (staff_profiles) are identified by name inside one
--      workspace by the availability engine, so active names must be unique;
--   2. one business-wide working-hours row per weekday (upsert target);
--   3. a hard, database-level backstop against double-booking the same
--      specialist at overlapping times — the application checks first, this
--      guarantees that two simultaneous requests can never both win.

create extension if not exists btree_gist;

-- 1. Active specialist names are unique per workspace (case-insensitive).
--    Inactive (soft-deleted) specialists keep their history and free the name.
create unique index if not exists idx_staff_workspace_active_name
  on staff_profiles (workspace_id, lower(name))
  where active;

-- 2. Exactly one default (staff_id is null) schedule row per weekday.
create unique index if not exists idx_working_hours_default_weekday
  on working_hours (workspace_id, weekday)
  where staff_id is null;

-- 3. No two live appointments of the same specialist may overlap in time.
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
