-- ServiceOS — 0010: atomic, idempotent workspace provisioning + onboarding
--
-- provision_workspace()  — service role only. One transaction creates the
--   profile, the workspace (with a free, allowed slug), the owner
--   membership, the MAIN and PRIVATE financial buckets, the owner's staff
--   profile and the default working hours. Calling it again for the same
--   user returns the existing workspace and creates nothing (safe retry).
-- complete_onboarding()  — runs as the signed-in user (RLS applies). Saves
--   the wizard's answers once; a second call is a no-op.
--
-- Both are plain SQL functions in this repository: a fresh Supabase project
-- gets them by running the migrations — no hand-made objects.

create or replace function public.provision_workspace(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_business_name text,
  p_base_slug text,
  p_locale text default 'en'
)
returns table (out_workspace_id uuid, out_slug text, out_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_slug text;
  v_candidate text;
  v_base text;
  v_attempt int;
begin
  if p_user_id is null or p_email is null or char_length(trim(p_email)) = 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_business_name is null or char_length(trim(p_business_name)) = 0
     or char_length(p_business_name) > 200 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- Serialize concurrent calls for the same user (double submit / retry).
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  begin
    insert into public.profiles (id, email, full_name, locale)
    values (
      p_user_id,
      p_email,
      coalesce(p_full_name, ''),
      case when p_locale in ('en', 'de', 'uk', 'ru') then p_locale else 'en' end
    )
    on conflict (id) do nothing;
  exception when unique_violation then
    -- Same email already belongs to a different profile id.
    raise exception 'profile_email_conflict' using errcode = '23505';
  end;

  -- Idempotent: the user already owns a workspace -> return it.
  select m.workspace_id, w.slug
    into v_workspace, v_slug
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
  where m.profile_id = p_user_id and m.role = 'owner'
  order by m.created_at
  limit 1;

  if found then
    return query select v_workspace, v_slug, false;
    return;
  end if;

  v_base := left(coalesce(nullif(trim(p_base_slug), ''), 'workspace'), 50);
  -- A base that can never become allowed, even with a suffix (e.g. anything
  -- starting with "demo-"), falls back to a neutral base.
  if not public.is_slug_allowed(v_base || '-abcd') then
    v_base := 'workspace';
  end if;
  v_workspace := null;

  for v_attempt in 0..30 loop
    v_candidate := case
      when v_attempt = 0 then v_base
      else v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4)
    end;

    if public.is_slug_allowed(v_candidate)
       and not exists (select 1 from public.workspaces w where w.slug = v_candidate) then
      begin
        insert into public.workspaces (slug, name, created_by)
        values (v_candidate, trim(p_business_name), p_user_id)
        returning id into v_workspace;
        v_slug := v_candidate;
        exit;
      exception when unique_violation then
        v_workspace := null; -- lost a race for this slug; try the next candidate
      end;
    end if;
  end loop;

  if v_workspace is null then
    raise exception 'slug_allocation_failed' using errcode = 'P0001';
  end if;

  insert into public.workspace_members (workspace_id, profile_id, role)
  values (v_workspace, p_user_id, 'owner');

  insert into public.financial_buckets (workspace_id, name, slug, kind, is_default)
  values
    (v_workspace, 'Main business', 'main', 'main', true),
    (v_workspace, 'Private', 'private', 'private', false)
  on conflict (workspace_id, slug) do nothing;

  -- The owner is bookable from day one. "You" is the label the app already
  -- localizes (see getStaffLabel).
  insert into public.staff_profiles (workspace_id, profile_id, name)
  values (v_workspace, p_user_id, 'You');

  -- Workspace-wide default schedule (staff_id null): Mon-Fri 09-18, weekend off.
  insert into public.working_hours (workspace_id, staff_id, weekday, start_time, end_time, is_day_off)
  select v_workspace, null::uuid, d::smallint, '09:00'::time, '18:00'::time, false from generate_series(1, 5) d
  union all
  select v_workspace, null::uuid, d::smallint, null::time, null::time, true from unnest(array[0, 6]) d;

  return query select v_workspace, v_slug, true;
end;
$$;

revoke all on function public.provision_workspace(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.provision_workspace(uuid, text, text, text, text, text)
  to service_role;

create or replace function public.complete_onboarding(
  p_workspace_id uuid,
  p_industry text,
  p_booking_mode text,
  p_services jsonb default '[]'::jsonb,
  p_use_default_hours boolean default true
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_done timestamptz;
begin
  if not public.has_workspace_permission(p_workspace_id, 'settings.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select w.onboarding_completed_at into v_done
  from public.workspaces w
  where w.id = p_workspace_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_done is not null then
    return false; -- already completed: nothing is written twice
  end if;

  if p_industry is null or char_length(trim(p_industry)) not between 1 and 50
     or p_booking_mode not in ('appointments', 'jobs', 'projects') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_services, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_services, '[]'::jsonb)) > 50 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  update public.workspaces
     set industry = trim(p_industry),
         booking_mode = p_booking_mode,
         onboarding_completed_at = now()
   where id = p_workspace_id;

  insert into public.services (workspace_id, name, duration_minutes, price, currency)
  select p_workspace_id,
         left(trim(e ->> 'name'), 200),
         greatest(1, least(1440, coalesce((e ->> 'durationMinutes')::int, 30))),
         greatest(0, least(1000000, coalesce((e ->> 'price')::numeric, 0))),
         'EUR'
  from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) e
  where char_length(trim(coalesce(e ->> 'name', ''))) > 0;

  if p_use_default_hours
     and not exists (select 1 from public.working_hours h
                     where h.workspace_id = p_workspace_id and h.staff_id is null) then
    insert into public.working_hours (workspace_id, staff_id, weekday, start_time, end_time, is_day_off)
    select p_workspace_id, null::uuid, d::smallint, '09:00'::time, '18:00'::time, false from generate_series(1, 5) d
    union all
    select p_workspace_id, null::uuid, d::smallint, null::time, null::time, true from unnest(array[0, 6]) d;
  end if;

  return true;
end;
$$;

revoke all on function public.complete_onboarding(uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function public.complete_onboarding(uuid, text, text, jsonb, boolean)
  to authenticated, service_role;
