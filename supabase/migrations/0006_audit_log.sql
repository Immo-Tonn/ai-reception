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
