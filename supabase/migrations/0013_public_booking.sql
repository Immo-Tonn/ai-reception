-- ServiceOS — 0013: public (guest) booking API
--
-- A guest has no account and no JWT. They never touch tables: a trusted
-- server action calls THESE functions with the service role, and nothing
-- else (EXECUTE is revoked from everyone but service_role).
--
--   get_public_booking_catalog(slug)  — public-safe facts about a business
--   get_public_busy(workspace, from, to) — occupied time ranges only
--   create_public_booking(...)        — ONE transaction: re-validate everything
--       against the database, find-or-create the client, insert the
--       appointment, append an audit entry. Price, duration, status, bucket
--       and visibility are decided HERE, never taken from the caller.
--       A time collision raises SQLSTATE 23P01 (exclusion_violation) from the
--       constraints in 0011 — that, not an earlier read, is what makes two
--       simultaneous requests safe.
--
-- Client matching mirrors src/features/publicBooking/bookingRules.ts
-- (`matchExistingClient`); a test runs both on the same cases.

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
  select ws.id, ws.name, ws.timezone, ws.auto_confirm_bookings
    into w
  from public.workspaces ws
  where ws.slug = p_slug;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'workspace', jsonb_build_object(
      'id', w.id, 'slug', p_slug, 'name', w.name,
      'timezone', w.timezone, 'autoConfirm', w.auto_confirm_bookings),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'durationMinutes', s.duration_minutes,
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
  from public.workspaces w2 where w2.id = p_workspace_id;
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

  -- The person must belong to this business, be active, and (when the service
  -- is restricted to certain people) be one of them.
  if not exists (select 1 from public.staff_profiles p
                 where p.id = p_staff_id and p.workspace_id = p_workspace_id and p.active) then
    raise exception 'staff_unavailable' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.service_staff l where l.service_id = p_service_id)
     and not exists (select 1 from public.service_staff l
                     where l.service_id = p_service_id and l.staff_id = p_staff_id) then
    raise exception 'staff_unavailable' using errcode = 'P0002';
  end if;

  -- Resource: required exactly when the service needs one, and of that type.
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

  -- Find-or-create the client inside this workspace. E-mail is the unique
  -- identity, so it wins; phone is the fallback. A guest can never rename or
  -- overwrite an existing client.
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

revoke all on function public.get_public_booking_catalog(text) from public, anon, authenticated;
revoke all on function public.get_public_busy(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.create_public_booking(uuid, uuid, uuid, uuid, timestamptz, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_public_booking_catalog(text) to service_role;
grant execute on function public.get_public_busy(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.create_public_booking(uuid, uuid, uuid, uuid, timestamptz, text, text, text, text)
  to service_role;
