-- ServiceOS — 0027: understandable Inbox events (snapshot at the moment of the
-- change) and a database guard against deleting appointments with history.
--
-- 1. inbox_events.details (jsonb): what the appointment looked like WHEN the
--    event happened — so a card still makes sense after later changes:
--      v, kind, client_id/name, service, staff_id/name, old/new starts_at,
--      duration, timezone, old/new status, initiator {kind, role, name}.
--    Private / owner-only / custom appointments keep NO client or service
--    details (same rule as the existing preview). Existing events are NOT
--    back-filled (their old values were never stored; nothing is invented).
-- 2. Initiator, decided inside the trigger:
--      business_user — auth.uid() is a member of this workspace (role + name kept);
--      client_online — no auth.uid(): the only service-role paths that write
--                      appointments are the guest booking (create_public_booking)
--                      and the client-account functions cancel_my_booking /
--                      reschedule_my_booking (both require the signed-in client);
--      a future caller may set `set_config('serviceos.actor_kind', '<kind>', true)`
--      (e.g. 'system') before writing, which wins.
-- 3. Dedupe key now includes the transaction id: a repeated real change
--    (move A -> B -> A, cancel -> restore -> cancel) creates a new event each
--    time; one row change still produces at most one event.
-- 4. guard_appointment_delete: physical deletion is refused for appointments
--    that already have a real outcome (completed / no-show / checked in / in
--    progress), came from online booking (source <> 'user'), or are linked to
--    an invoice, a client-account booking claim or the waiting list. They are
--    cancelled instead. Cascades (deleting a whole workspace) are not blocked.
-- 5. appointments.correct (owner / admin / manager): changing a RECORDED outcome
--    (completed / no-show / cancelled, incl. restoring a cancelled appointment)
--    is a correction of history. guard_appointment_history refuses it for other
--    roles even when the API is called directly (bypassing the app). Staff may
--    still set the first outcome. The change also creates an Inbox event with
--    old/new status and the initiator.
-- 6. forget_client_in_inbox: when a client is deleted (e.g. an erasure request),
--    their name / id are removed from the Inbox snapshots and previews of that
--    workspace. The events themselves stay (a booking happened), without
--    personal data. Notifications are NOT the appointment history: deleting or
--    ageing out an Inbox event never touches appointments or audit_logs.
--
-- Additive: one new column, one permission row per role, functions replaced in
-- place. No existing row is changed.

alter table public.inbox_events
  add column if not exists details jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inbox_events_details_shape') then
    alter table public.inbox_events
      add constraint inbox_events_details_shape
      check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 4000);
  end if;
end;
$$;

create or replace function public.record_appointment_inbox_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_code text;
  v_title text;
  v_preview text := '';
  v_client uuid := null;
  v_first text;
  v_client_name text;
  v_service text;
  v_staff text;
  v_uid uuid := (select auth.uid());
  v_actor uuid := null;
  v_actor_kind text;
  v_actor_role text;
  v_actor_name text;
  v_override text := nullif(current_setting('serviceos.actor_kind', true), '');
  v_details jsonb;
begin
  if tg_op = 'INSERT' then
    v_type := 'booking_created';
    v_code := 'booking.created';
    v_title := 'New booking';
  elsif new.starts_at is distinct from old.starts_at then
    v_type := 'booking_rescheduled';
    v_code := 'booking.rescheduled';
    v_title := 'Booking rescheduled';
  elsif new.status is distinct from old.status and new.status in ('confirmed', 'cancelled', 'completed', 'no_show') then
    if new.status = 'cancelled' then
      v_type := 'booking_cancelled';
    else
      v_type := 'booking_status';
    end if;
    v_code := 'booking.' || new.status::text;
    v_title := case new.status::text
      when 'confirmed' then 'Booking confirmed'
      when 'cancelled' then 'Booking cancelled'
      when 'completed' then 'Booking completed'
      else 'Booking marked as no-show' end;
  else
    return new;
  end if;

  -- Who made the change.
  if v_override is not null then
    v_actor_kind := left(v_override, 30);
  elsif v_uid is not null then
    select m.role::text into v_actor_role
      from public.workspace_members m
     where m.workspace_id = new.workspace_id and m.profile_id = v_uid;
    if v_actor_role is not null then
      v_actor_kind := 'business_user';
      v_actor := v_uid;
      select left(nullif(btrim(p.full_name), ''), 80) into v_actor_name from public.profiles p where p.id = v_uid;
    else
      v_actor_kind := 'unknown';
    end if;
  else
    v_actor_kind := 'client_online';
  end if;

  if new.staff_id is not null then
    select left(s.name, 80) into v_staff from public.staff_profiles s where s.id = new.staff_id;
  end if;

  -- Details only for ordinary appointments; private / owner-only / custom stay generic.
  if new.visibility = 'normal' then
    if new.client_id is not null then
      v_client := new.client_id;
      select left(btrim(c.name), 120) into v_client_name from public.clients c where c.id = new.client_id;
      v_first := left(split_part(coalesce(v_client_name, ''), ' ', 1), 40);
    end if;
    if new.service_id is not null then
      select left(s.name, 80) into v_service from public.services s where s.id = new.service_id;
    end if;
    v_preview := left(concat_ws(' · ',
      nullif(v_first, ''), nullif(v_service, ''),
      to_char(new.starts_at at time zone new.timezone, 'YYYY-MM-DD HH24:MI')), 200);
  end if;

  v_details := jsonb_strip_nulls(jsonb_build_object(
    'v', 1,
    'private', new.visibility <> 'normal',
    'client_id', case when new.visibility = 'normal' then new.client_id end,
    'client_name', case when new.visibility = 'normal' then v_client_name end,
    'service', case when new.visibility = 'normal' then v_service end,
    'staff_id', new.staff_id,
    'staff_name', v_staff,
    'starts_at', new.starts_at,
    'old_starts_at', case when tg_op = 'UPDATE' and new.starts_at is distinct from old.starts_at then old.starts_at end,
    'duration_minutes', (extract(epoch from (new.ends_at - new.starts_at)) / 60)::int,
    'timezone', new.timezone,
    'status', new.status::text,
    'old_status', case when tg_op = 'UPDATE' and new.status is distinct from old.status then old.status::text end,
    'initiator', jsonb_strip_nulls(jsonb_build_object('kind', v_actor_kind, 'role', v_actor_role, 'name', v_actor_name))
  ));

  begin
    insert into public.inbox_events
      (workspace_id, type, code, title, preview, entity_type, entity_id, client_id, actor_id, dedupe_key, details)
    values
      (new.workspace_id, v_type, v_code, v_title, v_preview, 'appointment', new.id::text, v_client, v_actor,
       'appointment:' || new.id::text || ':' || v_code || ':' || txid_current()::text,
       v_details)
    on conflict (workspace_id, dedupe_key) do nothing;
  exception when others then
    -- An inbox hiccup must never block a booking.
    raise warning 'inbox event skipped: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.record_appointment_inbox_event() from public, anon, authenticated;

-- Physical deletion only for appointments created by mistake (see header).
create or replace function public.guard_appointment_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Deleting the whole workspace (or another cascade) removes everything; not our concern here.
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  if old.status in ('completed', 'no_show', 'checked_in', 'in_progress') then
    raise exception 'appointment_has_history' using errcode = '23514';
  end if;
  if old.source is distinct from 'user' then
    raise exception 'appointment_is_online_booking' using errcode = '23514';
  end if;
  if exists (select 1 from public.invoices i where i.appointment_id = old.id)
     or exists (select 1 from public.booking_claims b where b.appointment_id = old.id)
     or exists (select 1 from public.waiting_list w where w.booked_appointment_id = old.id) then
    raise exception 'appointment_has_links' using errcode = '23514';
  end if;
  return old;
end;
$$;

drop trigger if exists appointments_guard_delete on public.appointments;
create trigger appointments_guard_delete
  before delete on public.appointments
  for each row execute function public.guard_appointment_delete();

revoke all on function public.guard_appointment_delete() from public, anon, authenticated;

-- 5. Who may correct a recorded outcome (mirrors src/server/permissions/roles.ts).
insert into public.role_permissions (role, permission) values
  ('owner', 'appointments.correct'), ('admin', 'appointments.correct'), ('manager', 'appointments.correct')
on conflict do nothing;

create or replace function public.guard_appointment_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and old.status in ('completed', 'no_show', 'cancelled')
     and (select auth.uid()) is not null
     and not public.has_workspace_permission(old.workspace_id, 'appointments.correct') then
    raise exception 'appointment_correction_not_permitted' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_guard_history on public.appointments;
create trigger appointments_guard_history
  before update of status on public.appointments
  for each row execute function public.guard_appointment_history();

revoke all on function public.guard_appointment_history() from public, anon, authenticated;

-- 6. A deleted client disappears from Inbox snapshots (no personal data left behind).
create or replace function public.forget_client_in_inbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.inbox_events e
     set details = e.details - 'client_name' - 'client_id',
         preview = ''
   where e.workspace_id = old.workspace_id
     and (e.client_id = old.id or e.details->>'client_id' = old.id::text);
  return old;
end;
$$;

drop trigger if exists clients_forget_in_inbox on public.clients;
create trigger clients_forget_in_inbox
  before delete on public.clients
  for each row execute function public.forget_client_in_inbox();

revoke all on function public.forget_client_in_inbox() from public, anon, authenticated;
