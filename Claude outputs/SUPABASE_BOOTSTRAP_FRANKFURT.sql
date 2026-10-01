-- ============================================================================
-- ServiceOS (ai-reception) — единый bootstrap-скрипт для НОВОГО проекта
-- Supabase в регионе Central EU (Frankfurt).
--
-- Это объединение того, что раньше было выполнено в проекте Ireland в
-- НЕСКОЛЬКО шагов (создание таблиц + включение RLS + выдача прав
-- service_role) — в один скрипт, чтобы воссоздать точно такое же
-- состояние базы за один запуск.
--
-- Как использовать:
--   1. Создайте новый проект в Supabase Dashboard, регион Central EU
--      (Frankfurt).
--   2. Откройте в нём SQL Editor → New query.
--   3. Вставьте содержимое этого файла целиком и нажмите Run.
--   4. В Authentication → Providers отключите "Confirm email" (как в
--      старом проекте, для тестирования).
--   5. Project Settings → API Keys — скопируйте Project URL, anon/
--      publishable key и service_role/secret key в .env.local.
--
-- Скрипт идемпотентен для таблиц (create table if not exists) и для
-- индексов (create index if not exists), но типы (create type) и GRANT/
-- ALTER DEFAULT PRIVILEGES выполняются один раз на чистой базе — именно
-- для этого он и нужен: на новой, ещё пустой базе.
-- ============================================================================


-- ============================================================================
-- ЧАСТЬ 1 — Схема (таблицы, типы, индексы)
-- Идентично SUPABASE_BOOTSTRAP_ONCE.sql, использованному в проекте Ireland.
-- ============================================================================

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

-- ServiceOS — 0003: financial buckets
--
-- Created before `appointments` (0004) because appointments FK into this
-- table. Main/Private are seeded per workspace on creation (app-layer);
-- Custom is any additional row the owner adds — see SPEC.md §7.

create table if not exists financial_buckets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  kind text not null default 'custom' check (kind in ('main', 'private', 'custom')),
  color_token text not null default '--color-accent-blue',
  is_default boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create index if not exists idx_financial_buckets_workspace on financial_buckets(workspace_id);

-- At most one "main" and one "private" bucket per workspace — Custom
-- buckets are unrestricted in count.
create unique index if not exists idx_financial_buckets_one_main
  on financial_buckets(workspace_id) where kind = 'main';
create unique index if not exists idx_financial_buckets_one_private
  on financial_buckets(workspace_id) where kind = 'private';

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

-- ServiceOS — 0005: invoices, invoice line items, payments

create type invoice_status as enum ('draft', 'sent', 'paid', 'partially_paid', 'overdue', 'void');

-- §69/§97 non-negotiable requirement: visibility and financial bucket are
-- separate axes, never a single flag — same rule as appointments
-- (0004_scheduling.sql), applied here to invoices. A dedicated enum
-- (rather than reusing appointment_visibility) keeps each table's
-- constraint independently evolvable.
create type invoice_visibility as enum ('normal', 'private', 'owner_only', 'custom');

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  number text not null,
  client_id uuid references clients(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,
  financial_bucket_id uuid references financial_buckets(id),
  visibility invoice_visibility not null default 'normal',
  status invoice_status not null default 'draft',
  currency text not null default 'EUR',
  amount numeric(10, 2) not null default 0,
  issued_at date not null default current_date,
  due_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, number)
);

create index if not exists idx_invoices_workspace on invoices(workspace_id);
create index if not exists idx_invoices_client on invoices(client_id);
create index if not exists idx_invoices_bucket on invoices(financial_bucket_id);
create index if not exists idx_invoices_visibility on invoices(workspace_id, visibility);
create index if not exists idx_invoices_status on invoices(workspace_id, status);

create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  quantity numeric(10, 2) not null default 1,
  unit_price numeric(10, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_invoice_items_invoice on invoice_items(invoice_id);

create type payment_method as enum ('cash', 'bank_transfer', 'card', 'online', 'custom');

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete cascade,
  amount numeric(10, 2) not null,
  currency text not null default 'EUR',
  method payment_method not null default 'cash',
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_workspace on payments(workspace_id);
create index if not exists idx_payments_invoice on payments(invoice_id);

-- ServiceOS — 0006: audit log
--
-- Fields match src/features/auditLog/types.ts exactly (actor/action/
-- entity/entityId/before/after/timestamp/source) so the demo
-- localStorage/mock log and the real table are structurally identical.

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before jsonb,
  after jsonb,
  summary text not null default '',
  source text not null default 'user' check (source in ('user', 'assistant', 'automation', 'public')),
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_workspace on audit_logs(workspace_id);
create index if not exists idx_audit_logs_entity on audit_logs(entity_type, entity_id);
create index if not exists idx_audit_logs_created on audit_logs(workspace_id, created_at desc);


-- ============================================================================
-- ЧАСТЬ 2 — Row Level Security: включить на всех 19 таблицах, БЕЗ политик.
--
-- "Вариант А": anon/authenticated не имеют прямого доступа ни к чему
-- (deny-all), всё бизнес-чтение/запись идёт только через Server Actions
-- на service_role (RLS-bypassing) админ-клиенте. Именно поэтому здесь
-- нет ни одной команды `create policy`.
-- ============================================================================

alter table profiles enable row level security;
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table role_permissions enable row level security;
alter table clients enable row level security;
alter table staff_profiles enable row level security;
alter table services enable row level security;
alter table service_staff enable row level security;
alter table resources enable row level security;
alter table working_hours enable row level security;
alter table financial_buckets enable row level security;
alter table appointment_series enable row level security;
alter table appointments enable row level security;
alter table appointment_resources enable row level security;
alter table waiting_list enable row level security;
alter table invoices enable row level security;
alter table invoice_items enable row level security;
alter table payments enable row level security;
alter table audit_logs enable row level security;


-- ============================================================================
-- ЧАСТЬ 3 — Права доступа для service_role ("permission denied" фикс).
--
-- service_role обходит RLS (атрибут BYPASSRLS у роли), НО это не отменяет
-- обычные Postgres GRANT на уровне таблицы — Postgres сначала проверяет
-- GRANT, и только потом RLS-политики. Без этого блока каждый запрос
-- через service_role будет падать с "permission denied for table X",
-- именно это и произошло в проекте Ireland.
--
-- GRANT ALL — на все существующие сейчас таблицы/последовательности.
-- ALTER DEFAULT PRIVILEGES — чтобы то же самое автоматически
-- применялось к таблицам, которые появятся позже (новые миграции).
-- ============================================================================

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- ============================================================================
-- Готово. После выполнения этого скрипта:
--   - 19 таблиц созданы, с той же структурой, что в проекте Ireland;
--   - RLS включён на всех, политик нет (deny-all для anon/authenticated);
--   - service_role имеет полный доступ (нет "permission denied").
--
-- Не забудьте:
--   1. Authentication → Providers → отключить "Confirm email".
--   2. Project Settings → API Keys → скопировать URL + anon key +
--      service_role key в .env.local.
-- ============================================================================
