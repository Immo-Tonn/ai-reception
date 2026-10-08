-- ServiceOS — 0023: waiting list (real backend) + inbox events
--
-- WAITING LIST: the 0004 table is extended additively (contact snapshot, notes, status, booked
-- appointment, audit-ish columns) and gets real policies. Reads need appointments.view, creates
-- appointments.create, edits appointments.edit. Entries are NEVER hard-deleted by users (status
-- `closed` keeps the history); anon has nothing.
--
-- INBOX EVENTS: one row per business event the owner should notice (new booking, cancellation,
-- move, status change; later waiting list / work / finance). Producers:
--   * DATABASE TRIGGERS on appointments (SECURITY DEFINER, pinned search_path, EXECUTE revoked) —
--     they fire for the public booking RPC, My-bookings cancel/reschedule and normal UI writes alike;
--   * record_inbox_event() for waiting-list / work / finance / system events: a definer RPC that
--     checks the caller's permission per event type (bookings are trigger-only).
-- Reprocessing never duplicates: unique (workspace_id, dedupe_key) + ON CONFLICT DO NOTHING.
-- Members with appointments.view read; appointments.edit may only flip is_read/read_at (column
-- grant); nobody authenticated can insert or delete; anon has nothing.
-- PRIVACY: an event about a non-normal-visibility appointment is generic (no client, no preview).
--
-- Idempotent, additive: nothing is dropped or truncated.

-- 1. waiting_list ----------------------------------------------------------
alter table public.waiting_list
  add column if not exists guest_name text not null default '',
  add column if not exists guest_phone text not null default '',
  add column if not exists guest_email text not null default '',
  add column if not exists notes text not null default '',
  add column if not exists status text not null default 'waiting',
  add column if not exists booked_appointment_id uuid references public.appointments(id) on delete set null,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'waiting_list_status_chk' and conrelid = 'public.waiting_list'::regclass) then
    alter table public.waiting_list add constraint waiting_list_status_chk
      check (status in ('waiting', 'contacted', 'booked', 'closed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'waiting_list_days_chk' and conrelid = 'public.waiting_list'::regclass) then
    alter table public.waiting_list add constraint waiting_list_days_chk
      check (preferred_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'waiting_list_time_order_chk' and conrelid = 'public.waiting_list'::regclass) then
    alter table public.waiting_list add constraint waiting_list_time_order_chk
      check (preferred_time_start is null or preferred_time_end is null or preferred_time_start <= preferred_time_end);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'waiting_list_lengths_chk' and conrelid = 'public.waiting_list'::regclass) then
    alter table public.waiting_list add constraint waiting_list_lengths_chk
      check (char_length(guest_name) <= 200 and char_length(guest_phone) <= 40
             and char_length(guest_email) <= 200 and char_length(notes) <= 1000);
  end if;
  -- A client OR a guest name. NOT VALID: rows from before this migration are not re-checked.
  if not exists (select 1 from pg_constraint where conname = 'waiting_list_contact_chk' and conrelid = 'public.waiting_list'::regclass) then
    alter table public.waiting_list add constraint waiting_list_contact_chk
      check (client_id is not null or char_length(btrim(guest_name)) > 0) not valid;
  end if;
end
$$;

create index if not exists idx_waiting_list_workspace_status on public.waiting_list (workspace_id, status, created_at);
create index if not exists idx_waiting_list_client on public.waiting_list (client_id) where client_id is not null;

-- Same-workspace references + contact snapshot + updated_at.
create or replace function public.guard_waiting_list()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'cross_workspace_reference' using errcode = '23514';
  end if;
  if (new.client_id is not null and not exists (
        select 1 from public.clients x where x.id = new.client_id and x.workspace_id = new.workspace_id))
     or (new.service_id is not null and not exists (
        select 1 from public.services x where x.id = new.service_id and x.workspace_id = new.workspace_id))
     or (new.preferred_staff_id is not null and not exists (
        select 1 from public.staff_profiles x where x.id = new.preferred_staff_id and x.workspace_id = new.workspace_id))
     or (new.booked_appointment_id is not null and not exists (
        select 1 from public.appointments x where x.id = new.booked_appointment_id and x.workspace_id = new.workspace_id)) then
    raise exception 'cross_workspace_reference' using errcode = '23514';
  end if;

  -- A linked client fills the contact snapshot once (the list keeps showing a name if the client is edited later).
  if new.client_id is not null and btrim(new.guest_name) = '' then
    select x.name, x.phone, x.email into c from public.clients x where x.id = new.client_id;
    new.guest_name := left(coalesce(c.name, ''), 200);
    if new.guest_phone = '' then new.guest_phone := left(coalesce(c.phone, ''), 40); end if;
    if new.guest_email = '' then new.guest_email := left(coalesce(c.email, ''), 200); end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists waiting_list_guard on public.waiting_list;
create trigger waiting_list_guard
  before insert or update on public.waiting_list
  for each row execute function public.guard_waiting_list();
revoke all on function public.guard_waiting_list() from public, anon, authenticated;

alter table public.waiting_list enable row level security;

drop policy if exists waiting_list_select on public.waiting_list;
create policy waiting_list_select on public.waiting_list
  for select to authenticated using (public.has_workspace_permission(workspace_id, 'appointments.view'));
drop policy if exists waiting_list_insert on public.waiting_list;
create policy waiting_list_insert on public.waiting_list
  for insert to authenticated
  with check (
    public.has_workspace_permission(workspace_id, 'appointments.create')
    and created_by is not distinct from (select auth.uid())
  );
drop policy if exists waiting_list_update on public.waiting_list;
create policy waiting_list_update on public.waiting_list
  for update to authenticated
  using (public.has_workspace_permission(workspace_id, 'appointments.edit'))
  with check (public.has_workspace_permission(workspace_id, 'appointments.edit'));
-- No delete policy and no DELETE privilege: close an entry instead (status = 'closed').

revoke all on public.waiting_list from anon;
revoke delete on public.waiting_list from authenticated;
grant select, insert, update on public.waiting_list to authenticated;
grant all on public.waiting_list to service_role;

-- 2. inbox_events ----------------------------------------------------------
create table if not exists public.inbox_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type text not null check (type in (
    'booking_created', 'booking_cancelled', 'booking_rescheduled', 'booking_status',
    'waiting_list', 'work', 'finance', 'system')),
  -- Stable machine code (e.g. booking.created, booking.cancelled) so the UI can localise the title.
  code text not null default '' check (char_length(code) <= 60),
  title text not null check (char_length(title) between 1 and 160),
  preview text not null default '' check (char_length(preview) <= 200),
  entity_type text not null default '' check (char_length(entity_type) <= 40),
  entity_id text not null default '' check (char_length(entity_id) <= 80),
  client_id uuid references public.clients(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint inbox_events_dedupe_uniq unique (workspace_id, dedupe_key)
);

create index if not exists idx_inbox_events_workspace_time on public.inbox_events (workspace_id, created_at desc);
create index if not exists idx_inbox_events_unread on public.inbox_events (workspace_id) where not is_read;

-- Same-workspace client; read_at follows is_read.
create or replace function public.guard_inbox_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'cross_workspace_reference' using errcode = '23514';
  end if;
  if new.client_id is not null and not exists (
       select 1 from public.clients x where x.id = new.client_id and x.workspace_id = new.workspace_id) then
    raise exception 'cross_workspace_reference' using errcode = '23514';
  end if;
  if new.is_read then
    if new.read_at is null then new.read_at := now(); end if;
  else
    new.read_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists inbox_events_guard on public.inbox_events;
create trigger inbox_events_guard
  before insert or update on public.inbox_events
  for each row execute function public.guard_inbox_event();
revoke all on function public.guard_inbox_event() from public, anon, authenticated;

alter table public.inbox_events enable row level security;

drop policy if exists inbox_events_select on public.inbox_events;
create policy inbox_events_select on public.inbox_events
  for select to authenticated using (public.has_workspace_permission(workspace_id, 'appointments.view'));
drop policy if exists inbox_events_update on public.inbox_events;
create policy inbox_events_update on public.inbox_events
  for update to authenticated
  using (public.has_workspace_permission(workspace_id, 'appointments.edit'))
  with check (public.has_workspace_permission(workspace_id, 'appointments.edit'));
-- No insert / delete policy for authenticated: only the triggers below and record_inbox_event() write.

revoke all on public.inbox_events from anon, authenticated;
grant select on public.inbox_events to authenticated;
grant update (is_read, read_at) on public.inbox_events to authenticated;
grant all on public.inbox_events to service_role;

-- 3. Producer: appointments trigger -----------------------------------------
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
  v_service text;
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

  -- Details only for ordinary appointments; private / owner-only / custom stay generic.
  if new.visibility = 'normal' then
    if new.client_id is not null then
      v_client := new.client_id;
      select left(split_part(btrim(c.name), ' ', 1), 40) into v_first from public.clients c where c.id = new.client_id;
    end if;
    if new.service_id is not null then
      select left(s.name, 80) into v_service from public.services s where s.id = new.service_id;
    end if;
    v_preview := left(concat_ws(' · ',
      nullif(v_first, ''), nullif(v_service, ''),
      to_char(new.starts_at at time zone new.timezone, 'YYYY-MM-DD HH24:MI')), 200);
  end if;

  begin
    insert into public.inbox_events
      (workspace_id, type, code, title, preview, entity_type, entity_id, client_id, actor_id, dedupe_key)
    values
      (new.workspace_id, v_type, v_code, v_title, v_preview, 'appointment', new.id::text, v_client,
       (select p.id from public.profiles p where p.id = (select auth.uid())),
       'appointment:' || new.id::text || ':' || new.status::text || ':' || extract(epoch from new.starts_at)::bigint::text)
    on conflict (workspace_id, dedupe_key) do nothing;
  exception when others then
    -- An inbox hiccup must never block a booking.
    raise warning 'inbox event skipped: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists appointments_inbox_event on public.appointments;
create trigger appointments_inbox_event
  after insert or update of status, starts_at on public.appointments
  for each row execute function public.record_appointment_inbox_event();
revoke all on function public.record_appointment_inbox_event() from public, anon, authenticated;

-- 4. Producer: service-side events (waiting list / work / finance / system) ----
-- Permission per type; booking_* types are trigger-only. The actor is always the caller.
create or replace function public.record_inbox_event(
  p_workspace_id uuid,
  p_type text,
  p_code text,
  p_title text,
  p_preview text,
  p_entity_type text,
  p_entity_id text,
  p_client_id uuid,
  p_dedupe_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_allowed boolean;
begin
  v_allowed := case p_type
    when 'waiting_list' then public.has_workspace_permission(p_workspace_id, 'appointments.create')
                          or public.has_workspace_permission(p_workspace_id, 'appointments.edit')
    when 'work' then public.has_workspace_permission(p_workspace_id, 'clients.edit')
    when 'finance' then public.has_workspace_permission(p_workspace_id, 'finance.edit')
    when 'system' then public.has_workspace_permission(p_workspace_id, 'settings.manage')
    else false end;
  if not coalesce(v_allowed, false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if btrim(coalesce(p_title, '')) = '' or btrim(coalesce(p_dedupe_key, '')) = '' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  insert into public.inbox_events
    (workspace_id, type, code, title, preview, entity_type, entity_id, client_id, actor_id, dedupe_key)
  values
    (p_workspace_id, p_type, left(coalesce(p_code, ''), 60), left(btrim(p_title), 160),
     left(coalesce(p_preview, ''), 200), left(coalesce(p_entity_type, ''), 40), left(coalesce(p_entity_id, ''), 80),
     p_client_id, (select auth.uid()), left(p_dedupe_key, 200))
  on conflict (workspace_id, dedupe_key) do nothing
  returning id into v_id;
  return v_id; -- null when the same event was already recorded
end;
$$;

revoke all on function public.record_inbox_event(uuid, text, text, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.record_inbox_event(uuid, text, text, text, text, text, text, uuid, text) to authenticated, service_role;
