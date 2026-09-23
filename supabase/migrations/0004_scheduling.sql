-- ServiceOS — 0003: appointments, resources link, waiting list
--
-- §69/§97 non-negotiable requirement: visibility and financial bucket are
-- two independent columns, never collapsed into one `is_private` flag.
-- `financial_bucket_id` is a real FK (not an enum) because buckets are
-- workspace-defined rows (Main/Private are seeded defaults, Custom is
-- open-ended) — see 0004_finance.sql.

create type appointment_visibility as enum ('normal', 'private', 'owner_only', 'custom');

create type appointment_status as enum (
  'pending', 'confirmed', 'checked_in', 'in_progress',
  'completed', 'cancelled', 'no_show', 'rescheduled'
);

create table if not exists appointment_series (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly', 'custom')),
  interval_days int,
  occurrence_count int not null,
  created_at timestamptz not null default now()
);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  client_id uuid references clients(id) on delete set null,
  service_id uuid references services(id) on delete set null,
  staff_id uuid references staff_profiles(id) on delete set null,
  location_id uuid, -- reserved for §42 locations/branches, not modeled yet

  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Europe/Berlin',
  status appointment_status not null default 'pending',

  -- The two independent dimensions (§6, §7) — never merge these.
  visibility appointment_visibility not null default 'normal',
  financial_bucket_id uuid references financial_buckets(id),

  title text,
  client_notes text not null default '',
  internal_notes text not null default '',

  price numeric(10, 2) not null default 0,
  currency text not null default 'EUR',
  paid boolean not null default false,

  series_id uuid references appointment_series(id) on delete set null,

  source text not null default 'user' check (source in ('user', 'public', 'assistant', 'automation')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint appointments_time_order check (ends_at > starts_at)
);

create index if not exists idx_appointments_workspace on appointments(workspace_id);
create index if not exists idx_appointments_staff_time on appointments(staff_id, starts_at);
create index if not exists idx_appointments_client on appointments(client_id);
create index if not exists idx_appointments_series on appointments(series_id);
-- Conflict-detection reads always filter by workspace + day range + staff;
-- this composite index is what that query hits.
create index if not exists idx_appointments_workspace_time on appointments(workspace_id, starts_at);

create table if not exists appointment_resources (
  appointment_id uuid not null references appointments(id) on delete cascade,
  resource_id uuid not null references resources(id) on delete cascade,
  primary key (appointment_id, resource_id)
);

create index if not exists idx_appointment_resources_resource on appointment_resources(resource_id);

create table if not exists waiting_list (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  service_id uuid references services(id) on delete set null,
  preferred_staff_id uuid references staff_profiles(id) on delete set null,
  earliest_date date not null,
  latest_date date not null,
  preferred_days smallint[] not null default '{}',
  preferred_time_start time,
  preferred_time_end time,
  created_at timestamptz not null default now(),
  constraint waiting_list_date_order check (latest_date >= earliest_date)
);

create index if not exists idx_waiting_list_workspace on waiting_list(workspace_id);
create index if not exists idx_waiting_list_service on waiting_list(service_id);
