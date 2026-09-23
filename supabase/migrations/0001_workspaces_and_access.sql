-- ServiceOS — 0001: workspaces, membership, roles/permissions
--
-- Mirrors src/server/permissions/roles.ts exactly. When Supabase Auth is
-- connected, `profiles.id` = `auth.users.id`; until then this schema is
-- inert (no FK to auth.users is created here to avoid coupling migration
-- order to an Auth setup that doesn't exist yet in this environment).

create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  -- Will become `references auth.users(id) on delete cascade` once
  -- Supabase Auth is wired up (§ "auth abstraction" — see
  -- src/server/auth/session.ts for the app-side counterpart).
  email text not null unique,
  full_name text not null default '',
  locale text not null default 'en' check (locale in ('en', 'de', 'uk', 'ru')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  industry text,
  default_currency text not null default 'EUR',
  timezone text not null default 'Europe/Berlin',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type workspace_role as enum ('owner', 'admin', 'manager', 'staff', 'accountant');

create table if not exists workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role workspace_role not null default 'staff',
  created_at timestamptz not null default now(),
  unique (workspace_id, profile_id)
);

create index if not exists idx_workspace_members_workspace on workspace_members(workspace_id);
create index if not exists idx_workspace_members_profile on workspace_members(profile_id);

-- Every write in src/server/permissions/roles.ts maps 1:1 to a row here.
-- Kept as data (not just app-layer constants) so a future admin UI or an
-- RLS policy can read the matrix without redeploying code.
create table if not exists role_permissions (
  role workspace_role not null,
  permission text not null,
  primary key (role, permission)
);

insert into role_permissions (role, permission) values
  ('owner', 'appointments.view'), ('owner', 'appointments.create'), ('owner', 'appointments.edit'),
  ('owner', 'appointments.cancel'), ('owner', 'private_records.view'), ('owner', 'owner_records.view'),
  ('owner', 'finance.view'), ('owner', 'finance.edit'), ('owner', 'financial_bucket.main.view'),
  ('owner', 'financial_bucket.private.view'), ('owner', 'clients.view'), ('owner', 'clients.edit'),
  ('owner', 'staff.manage'), ('owner', 'settings.manage'), ('owner', 'billing.manage'),
  ('owner', 'audit_log.view'),
  ('admin', 'appointments.view'), ('admin', 'appointments.create'), ('admin', 'appointments.edit'),
  ('admin', 'appointments.cancel'), ('admin', 'finance.view'), ('admin', 'finance.edit'),
  ('admin', 'financial_bucket.main.view'), ('admin', 'clients.view'), ('admin', 'clients.edit'),
  ('admin', 'staff.manage'), ('admin', 'settings.manage'), ('admin', 'audit_log.view'),
  ('manager', 'appointments.view'), ('manager', 'appointments.create'), ('manager', 'appointments.edit'),
  ('manager', 'appointments.cancel'), ('manager', 'financial_bucket.main.view'),
  ('manager', 'clients.view'), ('manager', 'clients.edit'),
  ('staff', 'appointments.view'), ('staff', 'appointments.create'), ('staff', 'appointments.edit'),
  ('staff', 'clients.view'),
  ('accountant', 'finance.view'), ('accountant', 'financial_bucket.main.view'),
  ('accountant', 'financial_bucket.private.view'), ('accountant', 'audit_log.view')
on conflict do nothing;
