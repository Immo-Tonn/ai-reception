-- ServiceOS — 0019: staff scheduling foundation
-- Design: docs/STAFF_SCHEDULING.md (the DB half of it).
--
-- WHAT THIS ADDS (additive; nothing is dropped, renamed or deleted)
--   staff_profiles : title, sort_order, schedule_mode (inherit | custom; staff that already own
--                    working_hours rows are backfilled to custom, once)
--   working_hours  : CHECK for real intervals; trigger = several NON-overlapping intervals per
--                    weekday, never mixed with a day-off row of the same weekday and owner
--   time_off       : NEW. Business closures (staff_id null) and staff time off; full days or one
--                    partial day; private reason; same-workspace guard; RLS (members read,
--                    staff.manage writes)
--   resources      : description, sort_order
--   service_resources : NEW. Which resources a service may use (members read, staff.manage writes)
--   workspaces     : booking rules (min notice, horizon, slot interval, cancel / reschedule
--                    deadlines). auto_confirm_bookings already exists (0011). Writes stay behind
--                    the existing workspaces_update policy (settings.manage) - not touched here.
--   restrict-delete: staff, resources and services that appointments reference can never be hard
--                    deleted (history is never silently nulled); a whole-workspace cascade still works
--   public RPCs    : get_public_booking_catalog (rules, time off WITHOUT reasons, staff modes,
--                    per-service resource links, staff title, only active staff/resources ordered by
--                    sort_order), create_public_booking / reschedule_my_booking / cancel_my_booking
--                    (booking rules enforced; same signatures, service role only, as before)
--
-- Replay-safe: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- 1. staff_profiles
-- ---------------------------------------------------------------------------
alter table public.staff_profiles
  add column if not exists title text not null default ''
    check (char_length(title) <= 80),
  add column if not exists sort_order int not null default 0;

-- schedule_mode: added AND backfilled in one step, only the first time, so a replay can never
-- flip a deliberate 'inherit' back to 'custom'.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff_profiles' and column_name = 'schedule_mode'
  ) then
    alter table public.staff_profiles
      add column schedule_mode text not null default 'inherit'
        check (schedule_mode in ('inherit', 'custom'));
    update public.staff_profiles p
       set schedule_mode = 'custom'
     where exists (select 1 from public.working_hours h where h.staff_id = p.id);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. working_hours: several intervals per weekday, with integrity
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'working_hours_interval_chk'
                   and conrelid = 'public.working_hours'::regclass) then
    alter table public.working_hours
      add constraint working_hours_interval_chk
      check (is_day_off or (start_time is not null and end_time is not null and end_time > start_time));
  end if;
end
$$;

-- Owner = (workspace, staff or the business itself). Rejects overlapping intervals and any mix of
-- a day-off row with intervals on the same weekday. Intervals that merely touch (09-12, 12-18) are fine.
create or replace function public.guard_working_hours_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Serialize concurrent writers of the same owner + weekday (two inserts cannot both pass the check).
  perform pg_advisory_xact_lock(hashtextextended(
    'working_hours:' || new.workspace_id::text || ':' || coalesce(new.staff_id::text, '-') || ':' || new.weekday::text, 0));

  if new.is_day_off then
    if exists (select 1 from public.working_hours h
               where h.workspace_id = new.workspace_id
                 and h.staff_id is not distinct from new.staff_id
                 and h.weekday = new.weekday
                 and h.id <> new.id
                 and not h.is_day_off) then
      raise exception 'working_hours_day_off_conflict' using errcode = '23514',
        hint = 'Remove the intervals of this weekday before marking it as a day off.';
    end if;
  else
    if exists (select 1 from public.working_hours h
               where h.workspace_id = new.workspace_id
                 and h.staff_id is not distinct from new.staff_id
                 and h.weekday = new.weekday
                 and h.id <> new.id
                 and h.is_day_off) then
      raise exception 'working_hours_day_off_conflict' using errcode = '23514',
        hint = 'This weekday is marked as a day off; remove that row first.';
    end if;
    if exists (select 1 from public.working_hours h
               where h.workspace_id = new.workspace_id
                 and h.staff_id is not distinct from new.staff_id
                 and h.weekday = new.weekday
                 and h.id <> new.id
                 and not h.is_day_off
                 and h.start_time < new.end_time
                 and h.end_time > new.start_time) then
      raise exception 'working_hours_overlap' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists working_hours_integrity on public.working_hours;
create trigger working_hours_integrity
  before insert or update on public.working_hours
  for each row execute function public.guard_working_hours_integrity();

-- ---------------------------------------------------------------------------
-- 3. time_off
-- ---------------------------------------------------------------------------
create table if not exists public.time_off (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- null staff_id = the whole business is closed.
  staff_id uuid references public.staff_profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  start_time time,
  end_time time,
  reason text not null default '' check (char_length(reason) <= 200),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint time_off_dates_chk check (end_date >= start_date),
  constraint time_off_times_pair_chk check ((start_time is null) = (end_time is null)),
  constraint time_off_partial_day_chk
    check (start_time is null or (start_date = end_date and end_time > start_time))
);

create index if not exists idx_time_off_workspace_dates on public.time_off (workspace_id, end_date, start_date);
create index if not exists idx_time_off_staff on public.time_off (staff_id) where staff_id is not null;

-- Same-workspace guard for the two new tables (extends the 0011 pattern; the 0011 function is untouched).
create or replace function public.guard_scheduling_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'time_off' then
    if new.staff_id is not null and not exists (
         select 1 from public.staff_profiles p where p.id = new.staff_id and p.workspace_id = new.workspace_id) then
      raise exception 'cross_workspace_reference' using errcode = '23514';
    end if;
  elsif tg_table_name = 'service_resources' then
    if not exists (select 1 from public.services s
                   join public.resources r on r.workspace_id = s.workspace_id
                   where s.id = new.service_id and r.id = new.resource_id) then
      raise exception 'cross_workspace_reference' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists time_off_guard_refs on public.time_off;
create trigger time_off_guard_refs
  before insert or update on public.time_off
  for each row execute function public.guard_scheduling_references();

alter table public.time_off enable row level security;

drop policy if exists time_off_select on public.time_off;
create policy time_off_select on public.time_off
  for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists time_off_insert on public.time_off;
create policy time_off_insert on public.time_off
  for insert to authenticated
  with check (public.has_workspace_permission(workspace_id, 'staff.manage')
              and (created_by is null or created_by = (select auth.uid())));
drop policy if exists time_off_update on public.time_off;
create policy time_off_update on public.time_off
  for update to authenticated
  using (public.has_workspace_permission(workspace_id, 'staff.manage'))
  with check (public.has_workspace_permission(workspace_id, 'staff.manage'));
drop policy if exists time_off_delete on public.time_off;
create policy time_off_delete on public.time_off
  for delete to authenticated using (public.has_workspace_permission(workspace_id, 'staff.manage'));

revoke all on public.time_off from anon;
grant select, insert, update, delete on public.time_off to authenticated;
grant all on public.time_off to service_role;

-- ---------------------------------------------------------------------------
-- 4. resources + service_resources
-- ---------------------------------------------------------------------------
alter table public.resources
  add column if not exists description text not null default ''
    check (char_length(description) <= 300),
  add column if not exists sort_order int not null default 0;

create table if not exists public.service_resources (
  service_id uuid not null references public.services(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  primary key (service_id, resource_id)
);

create index if not exists idx_service_resources_resource on public.service_resources (resource_id);

drop trigger if exists service_resources_guard_refs on public.service_resources;
create trigger service_resources_guard_refs
  before insert or update on public.service_resources
  for each row execute function public.guard_scheduling_references();

alter table public.service_resources enable row level security;

drop policy if exists service_resources_select on public.service_resources;
create policy service_resources_select on public.service_resources
  for select to authenticated
  using (exists (select 1 from public.services s
                 where s.id = service_resources.service_id and public.is_workspace_member(s.workspace_id)));
drop policy if exists service_resources_insert on public.service_resources;
create policy service_resources_insert on public.service_resources
  for insert to authenticated
  with check (exists (select 1 from public.services s
                      where s.id = service_resources.service_id
                        and public.has_workspace_permission(s.workspace_id, 'staff.manage')));
drop policy if exists service_resources_update on public.service_resources;
create policy service_resources_update on public.service_resources
  for update to authenticated
  using (exists (select 1 from public.services s
                 where s.id = service_resources.service_id
                   and public.has_workspace_permission(s.workspace_id, 'staff.manage')))
  with check (exists (select 1 from public.services s
                      where s.id = service_resources.service_id
                        and public.has_workspace_permission(s.workspace_id, 'staff.manage')));
drop policy if exists service_resources_delete on public.service_resources;
create policy service_resources_delete on public.service_resources
  for delete to authenticated
  using (exists (select 1 from public.services s
                 where s.id = service_resources.service_id
                   and public.has_workspace_permission(s.workspace_id, 'staff.manage')));

revoke all on public.service_resources from anon;
grant select, insert, update, delete on public.service_resources to authenticated;
grant all on public.service_resources to service_role;

-- ---------------------------------------------------------------------------
-- 5. Booking rules on workspaces (writes: existing workspaces_update policy, settings.manage)
-- ---------------------------------------------------------------------------
alter table public.workspaces
  add column if not exists min_notice_minutes int not null default 0
    check (min_notice_minutes between 0 and 525600),
  add column if not exists max_horizon_days int not null default 90
    check (max_horizon_days between 1 and 180),
  add column if not exists slot_interval_minutes int not null default 15
    check (slot_interval_minutes in (5, 10, 15, 20, 30, 60)),
  add column if not exists cancellation_deadline_hours int not null default 0
    check (cancellation_deadline_hours between 0 and 720),
  add column if not exists reschedule_deadline_hours int not null default 0
    check (reschedule_deadline_hours between 0 and 720);

-- ---------------------------------------------------------------------------
-- 6. Restrict-delete: history is never silently nulled
--    appointments.staff_id / resource_id / service_id are ON DELETE SET NULL (0002/0004/0011).
--    These triggers refuse the delete instead. Archive with active = false.
--    A workspace cascade (parent row already gone) is let through.
-- ---------------------------------------------------------------------------
create or replace function public.guard_restrict_delete_with_appointments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used boolean;
begin
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old; -- the whole workspace is being deleted
  end if;

  if tg_table_name = 'staff_profiles' then
    v_used := exists (select 1 from public.appointments a where a.staff_id = old.id);
  elsif tg_table_name = 'resources' then
    v_used := exists (select 1 from public.appointments a where a.resource_id = old.id);
  elsif tg_table_name = 'services' then
    v_used := exists (select 1 from public.appointments a where a.service_id = old.id);
  else
    v_used := false;
  end if;

  if v_used then
    raise exception 'restrict_delete: % row is referenced by appointments; archive it (active = false) instead', tg_table_name
      using errcode = '23503';
  end if;
  return old;
end;
$$;

drop trigger if exists staff_profiles_restrict_delete on public.staff_profiles;
create trigger staff_profiles_restrict_delete
  before delete on public.staff_profiles
  for each row execute function public.guard_restrict_delete_with_appointments();
drop trigger if exists resources_restrict_delete on public.resources;
create trigger resources_restrict_delete
  before delete on public.resources
  for each row execute function public.guard_restrict_delete_with_appointments();
drop trigger if exists services_restrict_delete on public.services;
create trigger services_restrict_delete
  before delete on public.services
  for each row execute function public.guard_restrict_delete_with_appointments();

-- Trigger functions are not an API (same rule as 0016).
revoke all on function public.guard_working_hours_integrity() from public, anon, authenticated;
revoke all on function public.guard_scheduling_references() from public, anon, authenticated;
revoke all on function public.guard_restrict_delete_with_appointments() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Public API (service role only; same signatures as before)
-- ---------------------------------------------------------------------------
create or replace function public.get_public_booking_catalog(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w record;
begin
  select ws.id, ws.name, ws.timezone, ws.auto_confirm_bookings, ws.description, ws.phone, ws.email,
         ws.website, ws.address_line1, ws.postal_code, ws.city, ws.country, ws.logo_path,
         ws.min_notice_minutes, ws.max_horizon_days, ws.slot_interval_minutes
    into w
  from public.workspaces ws
  where ws.slug = p_slug and ws.public_booking_enabled;

  -- Unknown slug and "booking switched off" look the same to the outside.
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'workspace', jsonb_build_object(
      'id', w.id, 'slug', p_slug, 'name', w.name,
      'timezone', w.timezone, 'autoConfirm', w.auto_confirm_bookings),
    'profile', jsonb_build_object(
      'description', w.description, 'phone', w.phone, 'email', w.email, 'website', w.website,
      'addressLine1', w.address_line1, 'postalCode', w.postal_code, 'city', w.city,
      'country', w.country, 'logoPath', w.logo_path),
    'rules', jsonb_build_object(
      'minNoticeMinutes', w.min_notice_minutes,
      'maxHorizonDays', w.max_horizon_days,
      'slotIntervalMinutes', w.slot_interval_minutes,
      'autoConfirm', w.auto_confirm_bookings),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'description', s.description,
        'durationMinutes', s.duration_minutes,
        'price', s.price, 'currency', s.currency,
        'bufferBeforeMinutes', s.buffer_before_minutes,
        'bufferAfterMinutes', s.buffer_after_minutes,
        'requiredResourceType', s.required_resource_type,
        'allowedStaffIds', coalesce((
          select jsonb_agg(l.staff_id) from public.service_staff l where l.service_id = s.id), '[]'::jsonb),
        'resourceIds', coalesce((
          select jsonb_agg(sr.resource_id) from public.service_resources sr where sr.service_id = s.id), '[]'::jsonb)
      ) order by s.created_at)
      from public.services s where s.workspace_id = w.id and s.active), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'title', p.title)
                       order by p.sort_order, p.created_at)
      from public.staff_profiles p where p.workspace_id = w.id and p.active), '[]'::jsonb),
    'staffModes', coalesce((
      select jsonb_agg(jsonb_build_object('staffId', p.id, 'mode', p.schedule_mode)
                       order by p.sort_order, p.created_at)
      from public.staff_profiles p where p.workspace_id = w.id and p.active), '[]'::jsonb),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'type', r.type::text)
                       order by r.sort_order, r.created_at)
      from public.resources r where r.workspace_id = w.id and r.active), '[]'::jsonb),
    'workingHours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staffId', h.staff_id, 'weekday', h.weekday,
        'start', to_char(h.start_time, 'HH24:MI'), 'end', to_char(h.end_time, 'HH24:MI'),
        'isDayOff', h.is_day_off))
      from public.working_hours h where h.workspace_id = w.id), '[]'::jsonb),
    -- No reason, no creator: those are private to the business.
    'timeOff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staffId', t.staff_id,
        'startDate', to_char(t.start_date, 'YYYY-MM-DD'), 'endDate', to_char(t.end_date, 'YYYY-MM-DD'),
        'startTime', to_char(t.start_time, 'HH24:MI'), 'endTime', to_char(t.end_time, 'HH24:MI'))
        order by t.start_date, t.created_at)
      from public.time_off t
      where t.workspace_id = w.id
        and t.end_date >= (now() at time zone w.timezone)::date - 1), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_public_booking(
  p_workspace_id uuid,
  p_service_id uuid,
  p_staff_id uuid,
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_name text,
  p_email text,
  p_phone text,
  p_notes text
)
returns table (
  out_appointment_id uuid, out_client_id uuid, out_status text,
  out_starts_at timestamptz, out_ends_at timestamptz, out_staff_id uuid, out_resource_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws record;
  svc record;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  v_name text := left(trim(coalesce(p_name, '')), 200);
  v_client uuid;
  v_bucket uuid;
  v_ends timestamptz;
  v_status public.appointment_status;
  v_appt uuid;
  v_resource uuid := p_resource_id;
begin
  select w2.id, w2.timezone, w2.auto_confirm_bookings, w2.min_notice_minutes, w2.max_horizon_days into ws
  from public.workspaces w2 where w2.id = p_workspace_id and w2.public_booking_enabled;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  select s.id, s.name, s.duration_minutes, s.price, s.currency, s.required_resource_type
    into svc
  from public.services s
  where s.id = p_service_id and s.workspace_id = p_workspace_id and s.active;
  if not found then raise exception 'service_unavailable' using errcode = 'P0002'; end if;

  if v_name = '' or (v_email = '' and v_phone = '') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  -- Booking rules of the business: lead time and horizon (latest day = today + horizon, business timezone).
  if p_starts_at is null
     or p_starts_at <= now()
     or p_starts_at < now() + make_interval(mins => ws.min_notice_minutes)
     or (p_starts_at at time zone ws.timezone)::date
          > (now() at time zone ws.timezone)::date + ws.max_horizon_days then
    raise exception 'invalid_time' using errcode = '22023';
  end if;

  if not exists (select 1 from public.staff_profiles p
                 where p.id = p_staff_id and p.workspace_id = p_workspace_id and p.active) then
    raise exception 'staff_unavailable' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.service_staff l where l.service_id = p_service_id)
     and not exists (select 1 from public.service_staff l
                     where l.service_id = p_service_id and l.staff_id = p_staff_id) then
    raise exception 'staff_unavailable' using errcode = 'P0002';
  end if;

  -- Resource: required exactly when the service needs one; of that type; and one of the service's
  -- linked resources when the service has any link.
  if svc.required_resource_type is not null then
    if v_resource is null or not exists (
         select 1 from public.resources r
         where r.id = v_resource and r.workspace_id = p_workspace_id and r.active
           and r.type::text = svc.required_resource_type) then
      raise exception 'resource_unavailable' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.service_resources l where l.service_id = p_service_id)
       and not exists (select 1 from public.service_resources l
                       where l.service_id = p_service_id and l.resource_id = v_resource) then
      raise exception 'resource_unavailable' using errcode = 'P0002';
    end if;
  else
    v_resource := null;
  end if;

  v_ends := p_starts_at + make_interval(mins => svc.duration_minutes);

  select b.id into v_bucket
  from public.financial_buckets b
  where b.workspace_id = p_workspace_id and b.kind = 'main' and not b.is_archived
  order by b.is_default desc, b.created_at limit 1;
  if v_bucket is null then raise exception 'workspace_not_ready' using errcode = 'P0002'; end if;

  if v_email <> '' then
    select c.id into v_client from public.clients c
    where c.workspace_id = p_workspace_id and lower(c.email) = v_email limit 1;
  end if;
  if v_client is null and v_phone <> '' then
    select c.id into v_client from public.clients c
    where c.workspace_id = p_workspace_id and c.phone_normalized = v_phone
    order by c.created_at limit 1;
  end if;
  if v_client is null then
    begin
      insert into public.clients (workspace_id, name, email, phone, tags)
      values (p_workspace_id, v_name, v_email, left(coalesce(p_phone, ''), 40), array['new'])
      returning id into v_client;
    exception when unique_violation then
      select c.id into v_client from public.clients c
      where c.workspace_id = p_workspace_id and lower(c.email) = v_email limit 1;
    end;
  end if;

  v_status := case when ws.auto_confirm_bookings then 'confirmed' else 'pending' end;

  insert into public.appointments (
    workspace_id, client_id, service_id, staff_id, resource_id, starts_at, ends_at, timezone,
    status, visibility, financial_bucket_id, client_notes, price, currency, source
  ) values (
    p_workspace_id, v_client, p_service_id, p_staff_id, v_resource, p_starts_at, v_ends, ws.timezone,
    v_status, 'normal', v_bucket, left(coalesce(p_notes, ''), 1000), svc.price, svc.currency, 'public'
  ) returning id into v_appt;

  insert into public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, summary, source)
  values (p_workspace_id, null, 'created', 'appointment', v_appt::text,
          'Public booking · ' || svc.name || ' · ' || to_char(p_starts_at at time zone ws.timezone, 'YYYY-MM-DD HH24:MI'),
          'public');

  return query select v_appt, v_client, v_status::text, p_starts_at, v_ends, p_staff_id, v_resource;
end;
$$;

-- Cancels the caller's own upcoming booking, unless the business's cancellation deadline has passed.
create or replace function public.cancel_my_booking(p_user_id uuid, p_appointment_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  v_deadline int;
begin
  select ap.id, ap.workspace_id, ap.status, ap.starts_at into a
  from public.appointments ap
  join public.booking_claims bc on bc.appointment_id = ap.id and bc.claimed_by = p_user_id
  where ap.id = p_appointment_id and ap.visibility = 'normal'
  for update of ap;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  select w.cancellation_deadline_hours into v_deadline from public.workspaces w where w.id = a.workspace_id;

  if a.status not in ('pending', 'confirmed')
     or a.starts_at <= now()
     or a.starts_at < now() + make_interval(hours => coalesce(v_deadline, 0)) then
    raise exception 'not_manageable' using errcode = '22023';
  end if;

  update public.appointments set status = 'cancelled', updated_at = now() where id = a.id;
  insert into public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, summary, source)
  values (a.workspace_id, null, 'cancelled', 'appointment', a.id::text, 'Cancelled by the client', 'public');
  return 'cancelled';
end;
$$;

-- Moves the caller's own upcoming booking. Working hours / time off are checked by the server engine first;
-- the booking rules, the reschedule deadline and the linked-resource rule are enforced here; overlaps are
-- decided by the exclusion constraints (23P01).
create or replace function public.reschedule_my_booking(
  p_user_id uuid, p_appointment_id uuid, p_new_starts_at timestamptz, p_staff_id uuid, p_resource_id uuid
)
returns table (out_starts_at timestamptz, out_ends_at timestamptz, out_status text, out_staff_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  svc record;
  ws record;
  v_resource uuid := p_resource_id;
  v_ends timestamptz;
  v_status public.appointment_status;
begin
  select ap.id, ap.workspace_id, ap.service_id, ap.status, ap.starts_at, ap.timezone into a
  from public.appointments ap
  join public.booking_claims bc on bc.appointment_id = ap.id and bc.claimed_by = p_user_id
  where ap.id = p_appointment_id and ap.visibility = 'normal'
  for update of ap;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  select w.id, w.timezone, w.auto_confirm_bookings, w.public_booking_enabled, w.min_notice_minutes,
         w.max_horizon_days, w.reschedule_deadline_hours into ws
  from public.workspaces w where w.id = a.workspace_id;

  if a.status not in ('pending', 'confirmed')
     or a.starts_at <= now()
     or a.starts_at < now() + make_interval(hours => ws.reschedule_deadline_hours) then
    raise exception 'not_manageable' using errcode = '22023';
  end if;
  if p_new_starts_at is null
     or p_new_starts_at <= now()
     or p_new_starts_at < now() + make_interval(mins => ws.min_notice_minutes)
     or (p_new_starts_at at time zone ws.timezone)::date
          > (now() at time zone ws.timezone)::date + ws.max_horizon_days then
    raise exception 'invalid_time' using errcode = '22023';
  end if;
  if not ws.public_booking_enabled then raise exception 'not_manageable' using errcode = '22023'; end if;

  select s.id, s.duration_minutes, s.required_resource_type into svc
  from public.services s
  where s.id = a.service_id and s.workspace_id = a.workspace_id and s.active;
  if not found then raise exception 'service_unavailable' using errcode = 'P0002'; end if;

  if not exists (select 1 from public.staff_profiles p
                 where p.id = p_staff_id and p.workspace_id = a.workspace_id and p.active) then
    raise exception 'staff_unavailable' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.service_staff l where l.service_id = svc.id)
     and not exists (select 1 from public.service_staff l where l.service_id = svc.id and l.staff_id = p_staff_id) then
    raise exception 'staff_unavailable' using errcode = 'P0002';
  end if;

  if svc.required_resource_type is not null then
    if v_resource is null or not exists (
         select 1 from public.resources r
         where r.id = v_resource and r.workspace_id = a.workspace_id and r.active
           and r.type::text = svc.required_resource_type) then
      raise exception 'resource_unavailable' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.service_resources l where l.service_id = svc.id)
       and not exists (select 1 from public.service_resources l
                       where l.service_id = svc.id and l.resource_id = v_resource) then
      raise exception 'resource_unavailable' using errcode = 'P0002';
    end if;
  else
    v_resource := null;
  end if;

  v_ends := p_new_starts_at + make_interval(mins => svc.duration_minutes);
  -- A moved booking needs the business's approval again unless it confirms automatically.
  v_status := case when ws.auto_confirm_bookings then 'confirmed' else 'pending' end;

  update public.appointments
     set starts_at = p_new_starts_at, ends_at = v_ends, staff_id = p_staff_id, resource_id = v_resource,
         status = v_status, updated_at = now()
   where id = a.id;

  insert into public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, summary, source)
  values (a.workspace_id, null, 'moved', 'appointment', a.id::text,
          'Moved by the client · ' || to_char(a.starts_at at time zone a.timezone, 'YYYY-MM-DD HH24:MI')
          || ' -> ' || to_char(p_new_starts_at at time zone a.timezone, 'YYYY-MM-DD HH24:MI'),
          'public');

  return query select p_new_starts_at, v_ends, v_status::text, p_staff_id;
end;
$$;

-- Grants restated: same signatures as before, service role only.
revoke all on function public.get_public_booking_catalog(text) from public, anon, authenticated;
revoke all on function public.create_public_booking(uuid, uuid, uuid, uuid, timestamptz, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.cancel_my_booking(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reschedule_my_booking(uuid, uuid, timestamptz, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_public_booking_catalog(text) to service_role;
grant execute on function public.create_public_booking(uuid, uuid, uuid, uuid, timestamptz, text, text, text, text)
  to service_role;
grant execute on function public.cancel_my_booking(uuid, uuid) to service_role;
grant execute on function public.reschedule_my_booking(uuid, uuid, timestamptz, uuid, uuid) to service_role;
