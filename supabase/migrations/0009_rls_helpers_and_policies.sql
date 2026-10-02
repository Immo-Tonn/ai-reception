-- ServiceOS — 0009: Row Level Security — helpers + Phase 1 policies
--
-- Model:
--   * Tenant isolation is enforced by the database, not only by app code.
--     A signed-in user (role `authenticated`) can only touch rows of
--     workspaces they are a member of; what they may do inside is decided
--     by `role_permissions` (the SQL twin of src/server/permissions/roles.ts).
--   * `anon` has NO policies anywhere => the anon key can read/write nothing.
--   * The service role bypasses RLS; it is used ONLY by trusted server code
--     for guest booking, provisioning and Auth admin — never for ordinary
--     authenticated business CRUD.
--   * Tables whose feature is not migrated yet (clients, appointments,
--     invoices, ...) get RLS enabled with NO policy = deny-all until their
--     phase adds policies. Enabling RLS here is what keeps a FRESH project
--     closed (0001-0006 create tables without RLS).
--
-- Idempotent: policies are dropped and recreated by name (they are ours).

-- 1. RLS on every table -------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.workspaces          enable row level security;
alter table public.workspace_members   enable row level security;
alter table public.role_permissions    enable row level security;
alter table public.clients             enable row level security;
alter table public.staff_profiles      enable row level security;
alter table public.services            enable row level security;
alter table public.service_staff       enable row level security;
alter table public.resources           enable row level security;
alter table public.working_hours       enable row level security;
alter table public.financial_buckets   enable row level security;
alter table public.appointment_series  enable row level security;
alter table public.appointments        enable row level security;
alter table public.appointment_resources enable row level security;
alter table public.waiting_list        enable row level security;
alter table public.invoices            enable row level security;
alter table public.invoice_items       enable row level security;
alter table public.payments            enable row level security;
alter table public.audit_logs          enable row level security;

-- 2. Helpers (SECURITY DEFINER so they can read membership without
--    recursing into the very policies that call them) ---------------------
create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.profile_id = (select auth.uid())
  );
$$;

create or replace function public.has_workspace_permission(p_workspace_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    join public.role_permissions rp on rp.role = m.role
    where m.workspace_id = p_workspace_id
      and m.profile_id = (select auth.uid())
      and rp.permission = p_permission
  );
$$;

create or replace function public.shares_workspace_with(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members me
    join public.workspace_members other on other.workspace_id = me.workspace_id
    where me.profile_id = (select auth.uid())
      and other.profile_id = p_profile_id
  );
$$;

revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.has_workspace_permission(uuid, text) from public, anon;
revoke all on function public.shares_workspace_with(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.has_workspace_permission(uuid, text) to authenticated, service_role;
grant execute on function public.shares_workspace_with(uuid) to authenticated, service_role;

-- Supabase grants these by default; stated here so a database created some
-- other way (plain Postgres, SQL Editor as another owner) behaves the same.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- 3. Policies -------------------------------------------------------------

-- profiles: your own row + people you share a workspace with; edit only your own.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_workspace_with(id));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- workspaces: members read; settings.manage may update (slug/identity is
-- locked by trigger in 0008). No insert/delete: workspaces are created only
-- by provision_workspace() (service role).
drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
  for select to authenticated
  using (public.is_workspace_member(id));

drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces
  for update to authenticated
  using (public.has_workspace_permission(id, 'settings.manage'))
  with check (public.has_workspace_permission(id, 'settings.manage'));

-- workspace_members: members see the roster; no client-side writes yet.
drop policy if exists workspace_members_select on public.workspace_members;
create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- role_permissions: a non-sensitive reference matrix.
drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (true);

-- staff_profiles
drop policy if exists staff_profiles_select on public.staff_profiles;
create policy staff_profiles_select on public.staff_profiles
  for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists staff_profiles_insert on public.staff_profiles;
create policy staff_profiles_insert on public.staff_profiles
  for insert to authenticated with check (public.has_workspace_permission(workspace_id, 'staff.manage'));
drop policy if exists staff_profiles_update on public.staff_profiles;
create policy staff_profiles_update on public.staff_profiles
  for update to authenticated
  using (public.has_workspace_permission(workspace_id, 'staff.manage'))
  with check (public.has_workspace_permission(workspace_id, 'staff.manage'));
drop policy if exists staff_profiles_delete on public.staff_profiles;
create policy staff_profiles_delete on public.staff_profiles
  for delete to authenticated using (public.has_workspace_permission(workspace_id, 'staff.manage'));

-- services
drop policy if exists services_select on public.services;
create policy services_select on public.services
  for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists services_insert on public.services;
create policy services_insert on public.services
  for insert to authenticated with check (public.has_workspace_permission(workspace_id, 'settings.manage'));
drop policy if exists services_update on public.services;
create policy services_update on public.services
  for update to authenticated
  using (public.has_workspace_permission(workspace_id, 'settings.manage'))
  with check (public.has_workspace_permission(workspace_id, 'settings.manage'));
drop policy if exists services_delete on public.services;
create policy services_delete on public.services
  for delete to authenticated using (public.has_workspace_permission(workspace_id, 'settings.manage'));

-- service_staff (no workspace_id column: resolve through the service)
drop policy if exists service_staff_select on public.service_staff;
create policy service_staff_select on public.service_staff
  for select to authenticated
  using (exists (select 1 from public.services s
                 where s.id = service_staff.service_id and public.is_workspace_member(s.workspace_id)));
drop policy if exists service_staff_write on public.service_staff;
create policy service_staff_write on public.service_staff
  for all to authenticated
  using (exists (select 1 from public.services s
                 where s.id = service_staff.service_id
                   and public.has_workspace_permission(s.workspace_id, 'settings.manage')))
  with check (exists (select 1 from public.services s
                      where s.id = service_staff.service_id
                        and public.has_workspace_permission(s.workspace_id, 'settings.manage')));

-- financial_buckets: PRIVATE buckets need the private permission, others the
-- main one. (Visibility and Financial Account stay independent axes.)
drop policy if exists financial_buckets_select on public.financial_buckets;
create policy financial_buckets_select on public.financial_buckets
  for select to authenticated
  using (
    case when kind = 'private'
      then public.has_workspace_permission(workspace_id, 'financial_bucket.private.view')
      else public.has_workspace_permission(workspace_id, 'financial_bucket.main.view')
    end
  );
drop policy if exists financial_buckets_write on public.financial_buckets;
create policy financial_buckets_write on public.financial_buckets
  for all to authenticated
  using (public.has_workspace_permission(workspace_id, 'settings.manage'))
  with check (public.has_workspace_permission(workspace_id, 'settings.manage'));

-- working_hours
drop policy if exists working_hours_select on public.working_hours;
create policy working_hours_select on public.working_hours
  for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists working_hours_write on public.working_hours;
create policy working_hours_write on public.working_hours
  for all to authenticated
  using (public.has_workspace_permission(workspace_id, 'settings.manage'))
  with check (public.has_workspace_permission(workspace_id, 'settings.manage'));
