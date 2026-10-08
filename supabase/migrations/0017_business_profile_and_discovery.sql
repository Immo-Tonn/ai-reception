-- ServiceOS — 0017: business profile, public booking switch, discoverability
--
-- WHAT THIS ADDS (additive only; nothing existing is renamed, dropped or rewritten)
--   workspaces: description, phone, email, website, address_line1/postal_code/city/country,
--               logo_path, public_booking_enabled, discoverable
--   services:   description
--   functions:  get_public_booking_catalog (now honours the switch + returns a public profile),
--               get_public_busy / create_public_booking (refuse a closed workspace),
--               list_discoverable_businesses (NEW, service role only)
--
-- TWO INDEPENDENT SWITCHES
--   public_booking_enabled  "/book/<slug> works for anyone who has the link"
--   discoverable            "listed in the ServiceOS client directory"
--   Discoverable implies bookable (a listed business nobody can book is useless),
--   enforced by a CHECK; the reverse is NOT required: a business may be bookable
--   by direct link only. Defaults: public_booking_enabled = true (existing
--   businesses such as the E2E workspace keep working; the onboarding flow
--   already hands out the booking link), discoverable = false (nobody is ever
--   listed without choosing to be).
--
-- PUBLIC DATA BOUNDARY
--   `anon` still has no policy on any table. A guest or the directory only ever
--   sees what the service-role-only functions below return: a small PUBLIC PROFILE
--   (name, description, contact details the owner entered for customers, website,
--   address, logo reference). Internal columns (created_by, default_currency,
--   booking_mode, auto_confirm_bookings, ...) are never part of it. Contact fields
--   are intended for customers; the owner is told so in the form.
--
-- WHO MAY CHANGE IT
--   Same as every other workspace setting: RLS policy workspaces_update
--   (settings.manage, 0009). Members of other workspaces cannot see or change
--   it. The slug stays immutable (trigger in 0008): renaming the business never
--   changes its public URL.
--
-- LOGO
--   Only a REFERENCE is stored: logo_path = '<workspace_id>/<file name>' inside a
--   storage bucket (created in a later migration together with its storage
--   policies: private-by-default bucket "business-logos", object path starts with
--   the workspace id, write/delete only for settings.manage of THAT workspace,
--   read via public URL only for workspaces with public_booking_enabled, size and
--   MIME limits set on the bucket). Never a URL, never image bytes.
--
-- AUDIT
--   audit_logs.entity_type is plain text (0006), so recording 'workspace' needs no
--   schema change; the TypeScript union gains 'workspace' with this release.
--
-- Replay-safe: every statement is idempotent. Appointments, clients, services,
-- workspaces and members are not touched except for new columns with defaults.

-- ---------------------------------------------------------------------------
-- workspaces: business profile + switches
-- ---------------------------------------------------------------------------
alter table public.workspaces
  add column if not exists description text not null default ''
    check (char_length(description) <= 1000),
  add column if not exists phone text not null default ''
    check (char_length(phone) <= 40),
  add column if not exists email text not null default ''
    check (email = '' or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  add column if not exists website text not null default ''
    check (website = '' or (char_length(website) <= 300 and website ~* '^https?://[^[:space:]]+$')),
  add column if not exists address_line1 text not null default ''
    check (char_length(address_line1) <= 200),
  add column if not exists postal_code text not null default ''
    check (char_length(postal_code) <= 20),
  add column if not exists city text not null default ''
    check (char_length(city) <= 100),
  add column if not exists country text not null default ''
    check (country = '' or country ~ '^[A-Z]{2}$'),
  add column if not exists logo_path text
    check (logo_path is null or logo_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,120}$'),
  add column if not exists public_booking_enabled boolean not null default true,
  add column if not exists discoverable boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workspaces_discoverable_requires_booking_chk'
      and conrelid = 'public.workspaces'::regclass
  ) then
    alter table public.workspaces
      add constraint workspaces_discoverable_requires_booking_chk
      check (not discoverable or public_booking_enabled);
  end if;
end
$$;

-- The directory query filters on this; partial index keeps it tiny.
create index if not exists idx_workspaces_discoverable
  on public.workspaces (name) where discoverable;

-- ---------------------------------------------------------------------------
-- services: description (was in docs/PROPOSED_MIGRATION_services.md)
-- ---------------------------------------------------------------------------
alter table public.services
  add column if not exists description text not null default ''
    check (char_length(description) <= 1000);

-- ---------------------------------------------------------------------------
-- Public API (service role only, as in 0013)
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
         ws.website, ws.address_line1, ws.postal_code, ws.city, ws.country, ws.logo_path
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
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'description', s.description,
        'durationMinutes', s.duration_minutes,
        'price', s.price, 'currency', s.currency,
        'bufferBeforeMinutes', s.buffer_before_minutes,
        'bufferAfterMinutes', s.buffer_after_minutes,
        'requiredResourceType', s.required_resource_type,
        'allowedStaffIds', coalesce((
          select jsonb_agg(l.staff_id) from public.service_staff l where l.service_id = s.id), '[]'::jsonb)
      ) order by s.created_at)
      from public.services s where s.workspace_id = w.id and s.active), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.created_at)
      from public.staff_profiles p where p.workspace_id = w.id and p.active), '[]'::jsonb),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'type', r.type::text) order by r.created_at)
      from public.resources r where r.workspace_id = w.id and r.active), '[]'::jsonb),
    'workingHours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staffId', h.staff_id, 'weekday', h.weekday,
        'start', to_char(h.start_time, 'HH24:MI'), 'end', to_char(h.end_time, 'HH24:MI'),
        'isDayOff', h.is_day_off))
      from public.working_hours h where h.workspace_id = w.id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_public_busy(p_workspace_id uuid, p_from timestamptz, p_to timestamptz)
returns table (staff_id uuid, resource_id uuid, busy_from timestamptz, busy_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.staff_id, a.resource_id, a.busy_from, a.busy_until
  from public.appointments a
  join public.workspaces w on w.id = a.workspace_id and w.public_booking_enabled
  where a.workspace_id = p_workspace_id
    and a.status in ('pending', 'confirmed', 'checked_in', 'in_progress')
    and a.busy_from < p_to
    and a.busy_until > p_from;
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
  select w2.id, w2.timezone, w2.auto_confirm_bookings into ws
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
  if p_starts_at is null or p_starts_at <= now() or p_starts_at > now() + interval '180 days' then
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

  if svc.required_resource_type is not null then
    if v_resource is null or not exists (
         select 1 from public.resources r
         where r.id = v_resource and r.workspace_id = p_workspace_id and r.active
           and r.type::text = svc.required_resource_type) then
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

-- Directory: ONLY businesses that chose to be listed AND can be booked. Public fields only.
create or replace function public.list_discoverable_businesses(p_limit int default 24, p_offset int default 0)
returns table (slug text, name text, industry text, description text, city text, country text, logo_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select w.slug, w.name, w.industry, w.description, w.city, w.country, w.logo_path
  from public.workspaces w
  where w.discoverable and w.public_booking_enabled
  order by w.name, w.slug
  limit least(greatest(coalesce(p_limit, 24), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.get_public_booking_catalog(text) from public, anon, authenticated;
revoke all on function public.get_public_busy(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.create_public_booking(uuid, uuid, uuid, uuid, timestamptz, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.list_discoverable_businesses(int, int) from public, anon, authenticated;
grant execute on function public.get_public_booking_catalog(text) to service_role;
grant execute on function public.get_public_busy(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.create_public_booking(uuid, uuid, uuid, uuid, timestamptz, text, text, text, text)
  to service_role;
grant execute on function public.list_discoverable_businesses(int, int) to service_role;
