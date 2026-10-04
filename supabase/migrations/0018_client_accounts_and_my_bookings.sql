-- ServiceOS — 0018: client accounts and "My bookings"
--
-- WHO IS WHO
--   ClientRecord (public.clients)   = a business's CRM row about a customer. Per workspace.
--   Client account (this migration) = the PERSON's own login (a Supabase Auth user) with a tiny
--                                     profile. Global, not tied to one business. The two are
--                                     deliberately different entities and are NOT merged.
--
-- HOW A PERSON GETS TO SEE A BOOKING (proof of ownership, never "a typed e-mail")
--   Right after a guest booking the server issues a secret CLAIM TOKEN for THAT appointment
--   (only its SHA-256 hash is stored). Whoever proves possession of the token (the browser
--   that made the booking, or a client that was already signed in at booking time) may attach
--   the appointment to their account. Access is therefore PER APPOINTMENT, not per ClientRecord:
--   a stranger who books with someone else's e-mail only ever gets the appointment they created
--   themselves, never the victim's other bookings or CRM data.
--   (A ClientRecord-level link needs a VERIFIED e-mail, i.e. Confirm email ON in production, and
--   is intentionally NOT built here; see HANDOFF_GRAPH.md.)
--
-- ACCESS MODEL
--   * The three new objects are never reachable with the anon or authenticated key:
--       - client_accounts: RLS, a person reads/writes ONLY their own row;
--       - booking_claims : RLS enabled, NO policy, privileges revoked from anon/authenticated.
--   * All booking access goes through service-role-only functions that take the user id from the
--     server's VERIFIED session (p_user_id). Same trust model as 0013 (guest booking).
--   * The list returns only fields meant for the customer and only visibility = 'normal'
--     appointments (never private/owner-only ones, never internal notes, bucket or price rules).
--   * Cancel / reschedule: only own, only pending/confirmed, only in the future; conflicts are
--     still decided by the exclusion constraints from 0011; every change is audited and is
--     immediately what the business sees (same appointments row).
--
-- Replay-safe and additive: no existing row, column or function is changed or removed.

-- ---------------------------------------------------------------------------
-- client_accounts
-- ---------------------------------------------------------------------------
create table if not exists public.client_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  phone text not null default '' check (char_length(phone) <= 40),
  locale text not null default 'en' check (locale in ('en', 'de', 'uk', 'ru')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_accounts enable row level security;

drop policy if exists client_accounts_select on public.client_accounts;
create policy client_accounts_select on public.client_accounts
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists client_accounts_insert on public.client_accounts;
create policy client_accounts_insert on public.client_accounts
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists client_accounts_update on public.client_accounts;
create policy client_accounts_update on public.client_accounts
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.client_accounts from anon;
grant select, insert, update on public.client_accounts to authenticated;
grant all on public.client_accounts to service_role;

-- ---------------------------------------------------------------------------
-- booking_claims: secret per appointment, hashed
-- ---------------------------------------------------------------------------
create table if not exists public.booking_claims (
  appointment_id uuid primary key references public.appointments(id) on delete cascade,
  token_hash text not null unique,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_booking_claims_claimed_by on public.booking_claims (claimed_by) where claimed_by is not null;

alter table public.booking_claims enable row level security;
revoke all on public.booking_claims from anon, authenticated;
grant all on public.booking_claims to service_role;

-- ---------------------------------------------------------------------------
-- Service-role functions
-- ---------------------------------------------------------------------------

-- Issues the secret for a (public) appointment. Returns the PLAIN token once; only its hash is kept.
create or replace function public.issue_booking_claim(p_appointment_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not exists (select 1 from public.appointments a where a.id = p_appointment_id and a.source = 'public') then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.booking_claims (appointment_id, token_hash, expires_at)
  values (p_appointment_id, encode(sha256(convert_to(v_token, 'utf8')), 'hex'), now() + interval '60 days')
  on conflict (appointment_id) do nothing;
  if not found then
    raise exception 'claim_exists' using errcode = '23505';
  end if;
  return v_token;
end;
$$;

-- Attaches the appointment behind the token to the account. Idempotent for the same user.
create or replace function public.claim_booking(p_user_id uuid, p_token text)
returns table (out_appointment_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  if p_user_id is null or p_token is null or char_length(p_token) < 32 or char_length(p_token) > 200 then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select bc.appointment_id, bc.claimed_by, bc.expires_at into c
  from public.booking_claims bc
  where bc.token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex');
  if not found or c.expires_at < now() then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if c.claimed_by is not null and c.claimed_by <> p_user_id then
    raise exception 'claim_used' using errcode = '42501';
  end if;
  update public.booking_claims
     set claimed_by = p_user_id, claimed_at = coalesce(claimed_at, now())
   where appointment_id = c.appointment_id;
  return query select c.appointment_id;
end;
$$;

-- The customer-facing view of the account's bookings. Nothing internal is returned.
create or replace function public.list_my_bookings(p_user_id uuid, p_limit int default 200)
returns table (
  out_appointment_id uuid, out_workspace_id uuid, out_workspace_slug text, out_workspace_name text,
  out_timezone text, out_starts_at timestamptz, out_ends_at timestamptz, out_status text,
  out_service_id uuid, out_service_name text, out_staff_id uuid, out_staff_name text,
  out_resource_id uuid, out_price numeric, out_currency text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.workspace_id, w.slug, w.name, a.timezone, a.starts_at, a.ends_at, a.status::text,
         a.service_id, s.name, a.staff_id, p.name, a.resource_id, a.price, a.currency
  from public.booking_claims bc
  join public.appointments a on a.id = bc.appointment_id
  join public.workspaces w on w.id = a.workspace_id
  left join public.services s on s.id = a.service_id
  left join public.staff_profiles p on p.id = a.staff_id
  where bc.claimed_by = p_user_id
    and a.visibility = 'normal'
  order by a.starts_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

-- Cancels the caller's own upcoming booking.
create or replace function public.cancel_my_booking(p_user_id uuid, p_appointment_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
begin
  select ap.id, ap.workspace_id, ap.status, ap.starts_at into a
  from public.appointments ap
  join public.booking_claims bc on bc.appointment_id = ap.id and bc.claimed_by = p_user_id
  where ap.id = p_appointment_id and ap.visibility = 'normal'
  for update of ap;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.status not in ('pending', 'confirmed') or a.starts_at <= now() then
    raise exception 'not_manageable' using errcode = '22023';
  end if;

  update public.appointments set status = 'cancelled', updated_at = now() where id = a.id;
  insert into public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, summary, source)
  values (a.workspace_id, null, 'cancelled', 'appointment', a.id::text, 'Cancelled by the client', 'public');
  return 'cancelled';
end;
$$;

-- Moves the caller's own upcoming booking. Working-hours / availability rules are checked by the
-- server first (same engine as guest booking); the database decides overlaps (23P01).
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
  if a.status not in ('pending', 'confirmed') or a.starts_at <= now() then
    raise exception 'not_manageable' using errcode = '22023';
  end if;
  if p_new_starts_at is null or p_new_starts_at <= now() or p_new_starts_at > now() + interval '180 days' then
    raise exception 'invalid_time' using errcode = '22023';
  end if;

  select w.id, w.auto_confirm_bookings, w.public_booking_enabled into ws
  from public.workspaces w where w.id = a.workspace_id;
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

revoke all on function public.issue_booking_claim(uuid) from public, anon, authenticated;
revoke all on function public.claim_booking(uuid, text) from public, anon, authenticated;
revoke all on function public.list_my_bookings(uuid, int) from public, anon, authenticated;
revoke all on function public.cancel_my_booking(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reschedule_my_booking(uuid, uuid, timestamptz, uuid, uuid) from public, anon, authenticated;
grant execute on function public.issue_booking_claim(uuid) to service_role;
grant execute on function public.claim_booking(uuid, text) to service_role;
grant execute on function public.list_my_bookings(uuid, int) to service_role;
grant execute on function public.cancel_my_booking(uuid, uuid) to service_role;
grant execute on function public.reschedule_my_booking(uuid, uuid, timestamptz, uuid, uuid) to service_role;
