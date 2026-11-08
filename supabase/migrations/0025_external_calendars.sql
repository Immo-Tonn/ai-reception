-- ServiceOS — 0025: external calendars (Google FreeBusy, one direction:
-- Google -> ServiceOS availability). Design: docs/EXTERNAL_CALENDAR.md.
--
--   external_calendar_connections : one per staff member (workspace_id + staff_id).
--       ENCRYPTED refresh token (AES-256-GCM in the app, key never in the DB),
--       the ids of the calendars whose busy time counts, and a CACHE of busy
--       intervals (start/end only — no titles, descriptions, attendees).
--   external_calendar_invites     : single-use connect links. Only the SHA-256
--       hash of the token is stored; the token itself exists only in the link.
--
-- SERVICE ROLE ONLY. RLS is enabled with NO policies and every privilege is
-- revoked from anon / authenticated / PUBLIC: no browser and no signed-in
-- business user can ever read a token, a calendar id or a busy interval
-- directly. The server reads them after its own authorization checks
-- (src/server/externalCalendar/*). Busy time reaches booking only as
-- "this person is taken at these times".
--
-- Idempotent; no existing table or row is changed.

create table if not exists public.external_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  provider text not null default 'google' check (provider in ('google')),
  status text not null default 'connected' check (status in ('connected', 'error', 'revoked')),
  refresh_token_ciphertext text check (refresh_token_ciphertext is null or char_length(refresh_token_ciphertext) between 20 and 4096),
  calendar_ids text[] not null default '{}'
    check (cardinality(calendar_ids) <= 10 and array_position(calendar_ids, null) is null),
  busy_intervals jsonb not null default '[]'::jsonb check (jsonb_typeof(busy_intervals) = 'array'),
  busy_window_from timestamptz,
  busy_window_until timestamptz,
  busy_fetched_at timestamptz,
  refresh_claimed_at timestamptz,
  last_success_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code in
    ('revoked', 'unavailable', 'rate_limited', 'calendar_not_found', 'invalid_response', 'not_configured')),
  last_error_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_calendar_one_per_staff unique (workspace_id, staff_id),
  constraint external_calendar_window_order check (
    busy_window_from is null or busy_window_until is null or busy_window_from < busy_window_until)
);

create index if not exists idx_external_calendar_connections_workspace on public.external_calendar_connections (workspace_id);

create table if not exists public.external_calendar_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_external_calendar_invites_staff on public.external_calendar_invites (workspace_id, staff_id);

-- Same-workspace guard: a foreign key proves the staff member exists, not that
-- it belongs to THIS workspace (same reasoning as 0011).
create or replace function public.guard_external_calendar_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.staff_profiles p where p.id = new.staff_id and p.workspace_id = new.workspace_id
  ) then
    raise exception 'cross_workspace_reference' using errcode = '23514';
  end if;
  if tg_table_name = 'external_calendar_connections' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists external_calendar_connections_guard on public.external_calendar_connections;
create trigger external_calendar_connections_guard
  before insert or update on public.external_calendar_connections
  for each row execute function public.guard_external_calendar_refs();

drop trigger if exists external_calendar_invites_guard on public.external_calendar_invites;
create trigger external_calendar_invites_guard
  before insert or update on public.external_calendar_invites
  for each row execute function public.guard_external_calendar_refs();

-- Service role only ---------------------------------------------------------
alter table public.external_calendar_connections enable row level security;
alter table public.external_calendar_invites enable row level security;

revoke all on public.external_calendar_connections from public, anon, authenticated;
revoke all on public.external_calendar_invites from public, anon, authenticated;
grant all on public.external_calendar_connections to service_role;
grant all on public.external_calendar_invites to service_role;

-- One refresh at a time per connection, with a back-off after failures.
-- Returns true when THIS caller may call the provider now.
create or replace function public.claim_external_calendar_refresh(
  p_connection_id uuid,
  p_claim_seconds integer,
  p_backoff_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_claim_seconds < 1 or p_claim_seconds > 600 or p_backoff_seconds < 0 or p_backoff_seconds > 3600 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  update public.external_calendar_connections c
     set refresh_claimed_at = now()
   where c.id = p_connection_id
     and c.status <> 'revoked'
     and (c.refresh_claimed_at is null or c.refresh_claimed_at < now() - make_interval(secs => p_claim_seconds))
     and (p_backoff_seconds = 0 or c.last_error_at is null
          or c.last_error_at < now() - make_interval(secs => p_backoff_seconds))
  returning c.id into v_id;
  return v_id is not null;
end;
$$;

-- New link for a staff member: earlier UNUSED links for that person stop working (expired, not deleted).
create or replace function public.issue_external_calendar_invite(
  p_workspace_id uuid,
  p_staff_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_expires_at <= now() or p_expires_at > now() + interval '7 days' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  -- Earlier unused links expire now (kept as history; nothing is deleted).
  update public.external_calendar_invites i
     set expires_at = now()
   where i.workspace_id = p_workspace_id and i.staff_id = p_staff_id and i.used_at is null and i.expires_at > now();
  insert into public.external_calendar_invites (workspace_id, staff_id, token_hash, expires_at, created_by)
  values (p_workspace_id, p_staff_id, p_token_hash, p_expires_at, p_created_by)
  returning id into v_id;
  return v_id;
end;
$$;

-- Single use: marks the link used if it is still valid. Returns the row only to the one caller that won.
create or replace function public.consume_external_calendar_invite(p_invite_id uuid)
returns table (out_workspace_id uuid, out_staff_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  update public.external_calendar_invites i
     set used_at = now()
   where i.id = p_invite_id and i.used_at is null and i.expires_at > now()
  returning i.workspace_id, i.staff_id;
end;
$$;

revoke all on function public.guard_external_calendar_refs() from public, anon, authenticated;
revoke all on function public.claim_external_calendar_refresh(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.issue_external_calendar_invite(uuid, uuid, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.consume_external_calendar_invite(uuid) from public, anon, authenticated;
grant execute on function public.claim_external_calendar_refresh(uuid, integer, integer) to service_role;
grant execute on function public.issue_external_calendar_invite(uuid, uuid, text, timestamptz, uuid) to service_role;
grant execute on function public.consume_external_calendar_invite(uuid) to service_role;
