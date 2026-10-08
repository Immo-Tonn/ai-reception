-- ServiceOS — 0012: Phase 2 Row Level Security + booking helpers
--
-- Same model as 0009: tenant isolation by workspace membership, actions by
-- role_permissions, `anon` has nothing, the service role is used only for
-- guest booking. This migration adds the booking tables.
--
-- PRIVACY (Visibility axis): who may see a whole appointment row depends on
-- its `visibility` (normal / private / owner_only / custom) and the viewer's
-- permissions — enforced HERE, in the database. People without access still
-- need to know the time is taken (busy block), so they get only the
-- non-sensitive columns through `list_masked_appointments()`.
-- FINANCE axis (financial bucket) is independent: it never changes who may
-- see a row; buckets themselves stay protected by their own policy (0009)
-- and are resolved through definer functions below.
--
-- Idempotent: our own policies are dropped and recreated by name.

-- 1. Helpers ---------------------------------------------------------------
create or replace function public.can_see_appointment(p_workspace_id uuid, p_visibility public.appointment_visibility)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member(p_workspace_id)
     and (
       p_visibility = 'normal'
       or (p_visibility in ('private', 'custom') and public.has_workspace_permission(p_workspace_id, 'private_records.view'))
       or (p_visibility = 'owner_only' and public.has_workspace_permission(p_workspace_id, 'owner_records.view'))
     );
$$;

-- Time-only view of appointments the caller may not see in full.
create or replace function public.list_masked_appointments(p_workspace_id uuid)
returns table (
  id uuid, staff_id uuid, resource_id uuid, starts_at timestamptz, ends_at timestamptz,
  timezone text, status public.appointment_status, visibility public.appointment_visibility
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.staff_id, a.resource_id, a.starts_at, a.ends_at, a.timezone, a.status, a.visibility
  from public.appointments a
  where a.workspace_id = p_workspace_id
    and public.has_workspace_permission(p_workspace_id, 'appointments.view')
    and not public.can_see_appointment(p_workspace_id, a.visibility);
$$;

-- Financial bucket lookup for writing an appointment/invoice. A bucket id is
-- returned only to someone allowed to use it: PRIVATE needs the private
-- permission. (Callers without it cannot even learn that it exists.)
create or replace function public.resolve_financial_bucket(
  p_workspace_id uuid, p_kind text, p_bucket_id uuid default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_kind text;
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_bucket_id is not null then
    select b.id, b.kind into v_id, v_kind
    from public.financial_buckets b
    where b.id = p_bucket_id and b.workspace_id = p_workspace_id and not b.is_archived;
  else
    select b.id, b.kind into v_id, v_kind
    from public.financial_buckets b
    where b.workspace_id = p_workspace_id and b.kind = p_kind and not b.is_archived
    order by b.is_default desc, b.created_at
    limit 1;
  end if;

  if v_id is null then
    raise exception 'bucket_not_found' using errcode = 'P0002';
  end if;
  if v_kind = 'private'
     and not public.has_workspace_permission(p_workspace_id, 'financial_bucket.private.view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_id;
end;
$$;

-- id -> kind map so rows can be shown with their Main/Private/Custom class
-- (no names, no colors). Members only; PRIVATE buckets are listed only for
-- someone allowed to use them, so others cannot tell which rows are private.
create or replace function public.workspace_financial_bucket_kinds(p_workspace_id uuid)
returns table (id uuid, kind text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.kind from public.financial_buckets b
  where b.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and (b.kind <> 'private'
         or public.has_workspace_permission(p_workspace_id, 'financial_bucket.private.view'));
$$;

revoke all on function public.can_see_appointment(uuid, public.appointment_visibility) from public, anon;
revoke all on function public.list_masked_appointments(uuid) from public, anon;
revoke all on function public.resolve_financial_bucket(uuid, text, uuid) from public, anon;
revoke all on function public.workspace_financial_bucket_kinds(uuid) from public, anon;
grant execute on function public.can_see_appointment(uuid, public.appointment_visibility) to authenticated, service_role;
grant execute on function public.list_masked_appointments(uuid) to authenticated, service_role;
grant execute on function public.resolve_financial_bucket(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.workspace_financial_bucket_kinds(uuid) to authenticated, service_role;

-- 2. Policies --------------------------------------------------------------

-- clients
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
  for select to authenticated using (public.has_workspace_permission(workspace_id, 'clients.view'));
drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients
  for insert to authenticated with check (public.has_workspace_permission(workspace_id, 'clients.edit'));
drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients
  for update to authenticated
  using (public.has_workspace_permission(workspace_id, 'clients.edit'))
  with check (public.has_workspace_permission(workspace_id, 'clients.edit'));

-- resources
drop policy if exists resources_select on public.resources;
create policy resources_select on public.resources
  for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists resources_write on public.resources;
create policy resources_write on public.resources
  for all to authenticated
  using (public.has_workspace_permission(workspace_id, 'settings.manage'))
  with check (public.has_workspace_permission(workspace_id, 'settings.manage'));

-- appointment_series
drop policy if exists appointment_series_select on public.appointment_series;
create policy appointment_series_select on public.appointment_series
  for select to authenticated using (public.has_workspace_permission(workspace_id, 'appointments.view'));
drop policy if exists appointment_series_insert on public.appointment_series;
create policy appointment_series_insert on public.appointment_series
  for insert to authenticated with check (public.has_workspace_permission(workspace_id, 'appointments.create'));

-- appointments: rows you may not see are NOT readable here (use list_masked_appointments)
drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select to authenticated
  using (
    public.has_workspace_permission(workspace_id, 'appointments.view')
    and public.can_see_appointment(workspace_id, visibility)
  );

drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments
  for insert to authenticated
  with check (
    public.has_workspace_permission(workspace_id, 'appointments.create')
    and public.can_see_appointment(workspace_id, visibility)
    and created_by is not distinct from (select auth.uid())
  );

drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments
  for update to authenticated
  using (
    (public.has_workspace_permission(workspace_id, 'appointments.edit')
       or public.has_workspace_permission(workspace_id, 'appointments.cancel'))
    and public.can_see_appointment(workspace_id, visibility)
  )
  with check (
    (public.has_workspace_permission(workspace_id, 'appointments.edit')
       or public.has_workspace_permission(workspace_id, 'appointments.cancel'))
    and public.can_see_appointment(workspace_id, visibility)
  );

drop policy if exists appointments_delete on public.appointments;
create policy appointments_delete on public.appointments
  for delete to authenticated
  using (
    public.has_workspace_permission(workspace_id, 'appointments.cancel')
    and public.can_see_appointment(workspace_id, visibility)
  );

-- audit_logs: readable with audit_log.view; members may append entries about their own actions
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated using (public.has_workspace_permission(workspace_id, 'audit_log.view'));
drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and source = 'user'
    and actor_id is not distinct from (select auth.uid())
  );
