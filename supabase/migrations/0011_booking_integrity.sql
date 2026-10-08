-- ServiceOS — 0011: booking integrity (double-booking protection in the DATABASE)
--
-- A UI/app-level availability check can be raced by two simultaneous
-- requests. These constraints make PostgreSQL itself refuse the second
-- booking, whatever the application does:
--   * busy_from / busy_until — the time an appointment really occupies,
--     INCLUDING the service's buffer before/after. A trigger computes them
--     (callers cannot forge them) from starts_at/ends_at + services buffers.
--   * EXCLUDE (staff_id, busy range)    — a person can't be in two places.
--   * EXCLUDE (resource_id, busy range) — a room/lift can't be used twice.
--   Only ACTIVE statuses block (pending / confirmed / checked_in /
--   in_progress); cancelled, completed, no_show, rescheduled free the slot.
-- Also: workspaces.auto_confirm_bookings (public bookings are PENDING unless
-- the business opts in) and a normalized-phone column for client matching.
--
-- Idempotent. Requires the `btree_gist` extension (shipped with Supabase and
-- every PostgreSQL). Applying to a database that ALREADY contains overlapping
-- active appointments for one staff/resource will fail on purpose — resolve
-- those first (the live test project has no appointments).

create extension if not exists btree_gist;

alter table public.workspaces
  add column if not exists auto_confirm_bookings boolean not null default false;

alter table public.appointments
  add column if not exists resource_id uuid references public.resources(id) on delete set null,
  add column if not exists busy_from timestamptz,
  add column if not exists busy_until timestamptz;

create index if not exists idx_appointments_resource_time
  on public.appointments (resource_id, starts_at) where resource_id is not null;

-- The occupied window = appointment + its service's buffers.
create or replace function public.set_appointment_busy_range()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before int := 0;
  v_after int := 0;
begin
  if new.service_id is not null then
    select s.buffer_before_minutes, s.buffer_after_minutes
      into v_before, v_after
    from public.services s
    where s.id = new.service_id;
  end if;
  new.busy_from := new.starts_at - make_interval(mins => coalesce(v_before, 0));
  new.busy_until := new.ends_at + make_interval(mins => coalesce(v_after, 0));
  return new;
end;
$$;

drop trigger if exists appointments_set_busy_range on public.appointments;
create trigger appointments_set_busy_range
  before insert or update on public.appointments
  for each row execute function public.set_appointment_busy_range();

-- Rows that predate this migration get a window equal to their own time.
update public.appointments
   set busy_from = starts_at, busy_until = ends_at
 where busy_from is null;

alter table public.appointments alter column busy_from set not null;
alter table public.appointments alter column busy_until set not null;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'appointments_busy_order_chk'
                   and conrelid = 'public.appointments'::regclass) then
    alter table public.appointments
      add constraint appointments_busy_order_chk check (busy_until > busy_from);
  end if;

  if not exists (select 1 from pg_constraint
                 where conname = 'appointments_no_staff_overlap'
                   and conrelid = 'public.appointments'::regclass) then
    alter table public.appointments
      add constraint appointments_no_staff_overlap
      exclude using gist (staff_id with =, tstzrange(busy_from, busy_until, '[)') with &&)
      where (staff_id is not null
             and status in ('pending', 'confirmed', 'checked_in', 'in_progress'));
  end if;

  if not exists (select 1 from pg_constraint
                 where conname = 'appointments_no_resource_overlap'
                   and conrelid = 'public.appointments'::regclass) then
    alter table public.appointments
      add constraint appointments_no_resource_overlap
      exclude using gist (resource_id with =, tstzrange(busy_from, busy_until, '[)') with &&)
      where (resource_id is not null
             and status in ('pending', 'confirmed', 'checked_in', 'in_progress'));
  end if;
end
$$;

-- Normalized phone (digits and a leading +) for "is this the same client?".
-- Not unique on purpose: e-mail is the unique identity (idx_clients_workspace_email).
alter table public.clients
  add column if not exists phone_normalized text
  generated always as (regexp_replace(phone, '[^0-9+]', '', 'g')) stored;

create index if not exists idx_clients_workspace_phone
  on public.clients (workspace_id, phone_normalized) where phone_normalized <> '';

-- Cross-workspace reference guard ------------------------------------------
-- A foreign key proves a row exists, not that it belongs to the SAME
-- business. Without this, someone allowed to write appointments in workspace
-- A could point `client_id` / `staff_id` / ... at workspace B's row by id.
-- RLS cannot see through that, so a trigger checks every reference.
create or replace function public.guard_workspace_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'appointments' then
    if (new.client_id is not null and not exists (
          select 1 from public.clients x where x.id = new.client_id and x.workspace_id = new.workspace_id))
       or (new.service_id is not null and not exists (
          select 1 from public.services x where x.id = new.service_id and x.workspace_id = new.workspace_id))
       or (new.staff_id is not null and not exists (
          select 1 from public.staff_profiles x where x.id = new.staff_id and x.workspace_id = new.workspace_id))
       or (new.resource_id is not null and not exists (
          select 1 from public.resources x where x.id = new.resource_id and x.workspace_id = new.workspace_id))
       or (new.financial_bucket_id is not null and not exists (
          select 1 from public.financial_buckets x where x.id = new.financial_bucket_id and x.workspace_id = new.workspace_id))
       or (new.series_id is not null and not exists (
          select 1 from public.appointment_series x where x.id = new.series_id and x.workspace_id = new.workspace_id)) then
      raise exception 'cross_workspace_reference' using errcode = '23514';
    end if;
  elsif tg_table_name = 'service_staff' then
    if not exists (select 1 from public.services s join public.staff_profiles p on p.workspace_id = s.workspace_id
                   where s.id = new.service_id and p.id = new.staff_id) then
      raise exception 'cross_workspace_reference' using errcode = '23514';
    end if;
  elsif tg_table_name = 'working_hours' then
    if new.staff_id is not null and not exists (
         select 1 from public.staff_profiles p where p.id = new.staff_id and p.workspace_id = new.workspace_id) then
      raise exception 'cross_workspace_reference' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_guard_refs on public.appointments;
create trigger appointments_guard_refs
  before insert or update on public.appointments
  for each row execute function public.guard_workspace_references();

drop trigger if exists service_staff_guard_refs on public.service_staff;
create trigger service_staff_guard_refs
  before insert or update on public.service_staff
  for each row execute function public.guard_workspace_references();

drop trigger if exists working_hours_guard_refs on public.working_hours;
create trigger working_hours_guard_refs
  before insert or update on public.working_hours
  for each row execute function public.guard_workspace_references();
