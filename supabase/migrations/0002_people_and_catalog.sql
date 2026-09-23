-- ServiceOS — 0002: clients, staff, services, resources
-- All workspace-scoped; every table carries workspace_id + an index on it,
-- since every query in the app is scoped by workspace (§ multi-tenant
-- non-negotiable requirement, SPEC.md §4).

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  email text not null default '',
  phone text not null default '',
  tags text[] not null default '{}',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clients_workspace on clients(workspace_id);
create unique index if not exists idx_clients_workspace_email
  on clients(workspace_id, lower(email)) where email <> '';

create table if not exists staff_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  name text not null,
  color_token text not null default '--color-accent-blue',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_staff_workspace on staff_profiles(workspace_id);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  duration_minutes int not null check (duration_minutes > 0),
  price numeric(10, 2) not null default 0,
  currency text not null default 'EUR',
  buffer_before_minutes int not null default 0,
  buffer_after_minutes int not null default 0,
  required_resource_type text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_services_workspace on services(workspace_id);

create table if not exists service_staff (
  service_id uuid not null references services(id) on delete cascade,
  staff_id uuid not null references staff_profiles(id) on delete cascade,
  primary key (service_id, staff_id)
);

create type resource_type as enum ('room', 'vehicle', 'equipment', 'custom');

create table if not exists resources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  type resource_type not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_resources_workspace on resources(workspace_id);

create table if not exists working_hours (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- null staff_id = the workspace-wide default schedule.
  staff_id uuid references staff_profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time,
  end_time time,
  is_day_off boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_working_hours_workspace on working_hours(workspace_id);
create index if not exists idx_working_hours_staff on working_hours(staff_id);
