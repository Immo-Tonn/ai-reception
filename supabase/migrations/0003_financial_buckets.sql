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
