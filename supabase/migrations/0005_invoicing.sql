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
