-- ServiceOS — 0016: security hardening (Supabase Advisor findings)
--
-- Apply AFTER the first E2E on ServiceOS Dev and BEFORE production.
-- Idempotent. Changes no business logic and loosens nothing.
--
-- 1. Trigger functions are not an API. Nobody needs EXECUTE on them to have
--    them fire (a trigger fires with the table's DML, not with the caller's
--    EXECUTE right), yet by default `anon` / `authenticated` / PUBLIC can
--    "execute" the SECURITY DEFINER ones through the REST API surface.
--    EXECUTE is revoked from PUBLIC, anon and authenticated; `postgres` (owner)
--    and `service_role` keep it.
--
-- 2. `btree_gist` (needed by the EXCLUDE constraints of 0011) was created in
--    `public`, which exposes ~200 internal operator-support functions in the
--    API schema. It is moved to the `extensions` schema. Existing constraints
--    and indexes reference the operator classes by OID, so they keep working
--    unchanged. If the migration role lacks the right to move the extension
--    (it must own it), the move is skipped with a WARNING instead of failing,
--    and can be done by the project owner; nothing else depends on it.
--    NOTE for future migrations: reference btree_gist operators/opclasses
--    through the `extensions` schema.
--
-- 3. Overlapping permissive policies. `financial_buckets_write` (and the other
--    `*_write` policies) were FOR ALL, which also covers SELECT and is OR-ed
--    with the `*_select` policy. For financial_buckets that was a real leak:
--    an `admin` (settings.manage, but NO private-bucket permission) could read
--    the PRIVATE bucket through the write policy's USING clause. Each `*_write`
--    policy is split into INSERT / UPDATE / DELETE with the same conditions, so
--    SELECT is governed only by the `*_select` policy. Write permissions are
--    unchanged.

-- 1. Trigger functions -----------------------------------------------------
revoke all on function public.guard_workspace_references() from public, anon, authenticated;
revoke all on function public.set_appointment_busy_range() from public, anon, authenticated;
revoke all on function public.guard_profile_update() from public, anon, authenticated;
revoke all on function public.guard_workspace_update() from public, anon, authenticated;

-- 2. btree_gist out of the exposed schema -------------------------------------
create schema if not exists extensions;

do $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'btree_gist' and n.nspname = 'public'
  ) then
    begin
      alter extension btree_gist set schema extensions;
    exception when others then
      raise warning 'btree_gist could not be moved out of public (%). Move it as the extension owner: ALTER EXTENSION btree_gist SET SCHEMA extensions;', sqlerrm;
    end;
  end if;
end
$$;

-- 3. Split FOR ALL write policies (SELECT stays with the *_select policy) ----
-- financial_buckets: settings.manage may change buckets; reading is governed ONLY by financial_buckets_select.
drop policy if exists financial_buckets_write on public.financial_buckets;
drop policy if exists financial_buckets_insert on public.financial_buckets;
create policy financial_buckets_insert on public.financial_buckets
  for insert to authenticated with check (public.has_workspace_permission(workspace_id, 'settings.manage'));
drop policy if exists financial_buckets_update on public.financial_buckets;
create policy financial_buckets_update on public.financial_buckets
  for update to authenticated
  using (public.has_workspace_permission(workspace_id, 'settings.manage'))
  with check (public.has_workspace_permission(workspace_id, 'settings.manage'));
drop policy if exists financial_buckets_delete on public.financial_buckets;
create policy financial_buckets_delete on public.financial_buckets
  for delete to authenticated using (public.has_workspace_permission(workspace_id, 'settings.manage'));

-- resources
drop policy if exists resources_write on public.resources;
drop policy if exists resources_insert on public.resources;
create policy resources_insert on public.resources
  for insert to authenticated with check (public.has_workspace_permission(workspace_id, 'settings.manage'));
drop policy if exists resources_update on public.resources;
create policy resources_update on public.resources
  for update to authenticated
  using (public.has_workspace_permission(workspace_id, 'settings.manage'))
  with check (public.has_workspace_permission(workspace_id, 'settings.manage'));
drop policy if exists resources_delete on public.resources;
create policy resources_delete on public.resources
  for delete to authenticated using (public.has_workspace_permission(workspace_id, 'settings.manage'));

-- working_hours
drop policy if exists working_hours_write on public.working_hours;
drop policy if exists working_hours_insert on public.working_hours;
create policy working_hours_insert on public.working_hours
  for insert to authenticated with check (public.has_workspace_permission(workspace_id, 'settings.manage'));
drop policy if exists working_hours_update on public.working_hours;
create policy working_hours_update on public.working_hours
  for update to authenticated
  using (public.has_workspace_permission(workspace_id, 'settings.manage'))
  with check (public.has_workspace_permission(workspace_id, 'settings.manage'));
drop policy if exists working_hours_delete on public.working_hours;
create policy working_hours_delete on public.working_hours
  for delete to authenticated using (public.has_workspace_permission(workspace_id, 'settings.manage'));

-- service_staff (no workspace_id column: resolved through the service)
drop policy if exists service_staff_write on public.service_staff;
drop policy if exists service_staff_insert on public.service_staff;
create policy service_staff_insert on public.service_staff
  for insert to authenticated
  with check (exists (select 1 from public.services s
                      where s.id = service_staff.service_id
                        and public.has_workspace_permission(s.workspace_id, 'settings.manage')));
drop policy if exists service_staff_update on public.service_staff;
create policy service_staff_update on public.service_staff
  for update to authenticated
  using (exists (select 1 from public.services s
                 where s.id = service_staff.service_id
                   and public.has_workspace_permission(s.workspace_id, 'settings.manage')))
  with check (exists (select 1 from public.services s
                      where s.id = service_staff.service_id
                        and public.has_workspace_permission(s.workspace_id, 'settings.manage')));
drop policy if exists service_staff_delete on public.service_staff;
create policy service_staff_delete on public.service_staff
  for delete to authenticated
  using (exists (select 1 from public.services s
                 where s.id = service_staff.service_id
                   and public.has_workspace_permission(s.workspace_id, 'settings.manage')));
