-- ServiceOS — 0008: workspace hardening
--
-- 1. onboarding_completed_at — makes onboarding safely re-runnable.
-- 2. Reserved / well-formed workspace slugs. A slug is a public URL
--    (`/<slug>/today`, `/book/<slug>`), so it must not collide with a
--    static route or a demo workspace. The list MUST stay in sync with
--    src/lib/workspace/reservedSlugs.ts (a unit test compares them).
-- 3. profiles.id -> auth.users.id (so deleting an auth user can never leave
--    an orphaned profile / its memberships behind).
--
-- Non-destructive and idempotent. Constraints are added NOT VALID so rows
-- that already exist in a live database are never rejected or rewritten;
-- they are enforced for every new/changed row.

alter table workspaces
  add column if not exists onboarding_completed_at timestamptz;

create or replace function public.is_slug_allowed(p_slug text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    p_slug is not null
    and p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and char_length(p_slug) between 3 and 60
    and p_slug not like 'demo-%'
    and p_slug <> all (array[
      'demo', 'book', 'client', 'business', 'login', 'signup', 'logout',
      'onboarding', 'embed', 'embed-demo', 'embed-js', 'api', 'auth', 'admin',
      'app', 'settings', 'static', 'assets', 'public', 'icons', 'manifest',
      'favicon', 'sitemap', 'robots', 'www', 'help', 'support', 'status',
      'dashboard', 'new'
    ]);
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workspaces_slug_allowed_chk'
      and conrelid = 'public.workspaces'::regclass
  ) then
    alter table public.workspaces
      add constraint workspaces_slug_allowed_chk
      check (public.is_slug_allowed(slug)) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_id_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_id_fkey
      foreign key (id) references auth.users (id) on delete cascade not valid;
  end if;
end
$$;

-- Immutable identity: a signed-in user may never change a workspace's slug
-- (it is a public URL) or a profile's id/email (email is owned by Auth).
-- The service role (auth.uid() is null) is exempt.
create or replace function public.guard_workspace_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if new.id is distinct from old.id
       or new.slug is distinct from old.slug
       or new.created_by is distinct from old.created_by then
      raise exception 'workspace_identity_immutable' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_guard_update on public.workspaces;
create trigger workspaces_guard_update
  before update on public.workspaces
  for each row execute function public.guard_workspace_update();

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if new.id is distinct from old.id or new.email is distinct from old.email then
      raise exception 'profile_identity_immutable' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();
