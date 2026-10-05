# Business operations backend: Work, Finance, Waiting list, Inbox, Analytics (migrations 0021-0024)

Authoritative contract for this stage. Extends the existing shared-backend pattern
(UI -> Server Action -> service -> repository/adapter -> Supabase under RLS; demo = in-memory/local fixtures).
Real workspaces NEVER fall back to demo/localStorage: backend errors are shown honestly.

## Ownership and migration numbers (each agent writes ONLY its own file; additive, replay-safe, no drop/delete/truncate)
| Module | Migration | Owner |
|---|---|---|
| Work (leads, quotes, jobs, projects) + invoice relation columns | `0021_work_pipeline.sql` | Agent B |
| Finance (invoice numbering, line items, payments, statuses, money) | `0022_finance_invoices.sql` | Agent A |
| Waiting list + Inbox events | `0023_waiting_list_and_inbox.sql` | Agent C |
| Analytics aggregates (SECURITY INVOKER RPCs) | `0024_analytics.sql` | Agent D (after A, B, C) |
Existing tables reused: clients, appointments, services, staff_profiles, financial_buckets (0003), invoices/invoice_items/payments (0005), waiting_list (0004), audit_logs (0006).

## Cross-cutting rules
- Visibility (normal|private|owner_only|custom) and Financial bucket (main|private|custom, `financial_bucket_id` UUID FK to financial_buckets) are TWO independent columns everywhere. Never one `is_private`. Edits must preserve owner_only/custom values the simple UI does not show (Visibility UI: Normal/Private; Finance UI: Main business/Private).
- Reuse the privacy helpers of 0012 (e.g. `can_see_appointment`, `resolve_financial_bucket`, `workspace_financial_bucket_kinds`) for RLS on rows that carry visibility / a bucket. Private bucket data is only visible with `financial_bucket.private.view` (owner). Aggregates must never bypass this: analytics RPCs are SECURITY INVOKER so RLS applies to every row they read.
- Permissions (src/server/permissions/roles.ts, default-deny, do not change the matrix): Finance read `finance.view`, write `finance.edit` (+ bucket permissions); Work read `clients.view`, write `clients.edit`; Waiting list / Inbox read `appointments.view`, write `appointments.create`/`appointments.edit`; Analytics counts `appointments.view`, revenue `finance.view` + bucket rules.
- Money: stored as `numeric(12,2)` (decimal-safe, existing columns stay `numeric(10,2)`->widen only if needed), computed in TS in INTEGER MINOR UNITS (cents) via one shared helper `src/lib/money.ts` (create it if absent; no floating-point sums, round half-up once per line). Currency = ISO code string, defaults to the workspace default_currency; an invoice stores its own currency (snapshot).
- Clients: all relations use `client_id uuid references clients(id)` + a same-workspace guard trigger (pattern: guard_workspace_references in 0011/0019). Never duplicate the client on conversions; keep a free-text `client_name` snapshot only where the UI already shows one.
- History: archive/status instead of delete wherever other rows reference an entity (restrict-delete triggers, 0019 pattern). Audit via the existing audit repository (entity types added to src/features/auditLog/types.ts with small Edit calls); one entry per meaningful change, no PII copies, no secrets.
- Tenant isolation: RLS on every new table (members read per permission, writes per permission), anon revoked, service role server-only. Negative tests required (cross-workspace read/write/FK, anon, roles, private bucket).
- Demo: the existing demo repositories/fixtures stay for demo-* slugs only (server registry already gates with isDemoWorkspaceSlug); real slugs use the new Supabase repositories/services.
- UI: keep the existing screens/components, wire them to the real backend; CSS Modules + tokens, mobile-first, >=44px targets, SaveStatus, DE/EN/UK/RU via small targeted Edit calls into src/lib/i18n/data/*.ts (never rewrite whole files; others edit concurrently).

## Domain
- Work pipeline: Lead -> Quote -> (accepted) Job and/or lightweight Project -> Invoice. Conversions are server-side, transactional (one SQL function per conversion), idempotent (a second conversion of the same lead/quote returns the existing result, never a duplicate), same client, same visibility/bucket unless changed.
- Finance: invoice (number unique per workspace, concurrency-safe numbering via a counter row updated atomically), line items, status (draft|sent|paid|partial|overdue|cancelled mapped onto the existing enum + UI), optional appointment/job/project/quote relation, bucket + visibility.
- Waiting list: entries (client or guest contact, service, preferred staff, date range, time range, status waiting|contacted|booked|closed, notes). No automatic booking; helper to open the booking form prefilled.
- Inbox: `inbox_events` (type, title, safe preview, entity type/id, client id, read flag, dedupe_key unique per workspace); events are produced by database triggers on appointments (public booking, cancel/reschedule, business changes) and by services for work/finance/waiting events; reprocessing never duplicates (ON CONFLICT DO NOTHING on the dedupe key). External messages (WhatsApp/email) are a future adapter; the existing Conversation UI stays demo-only.
- Analytics: SECURITY INVOKER SQL functions over appointments, clients, invoices, work tables; revenue only from buckets the caller may see.

## As built (2026-10-05)
- Migrations 0021-0024 applied to ServiceOS Dev (dry-run, ref matched .env.local, existing tables were empty, data intact, anon 401 everywhere).
- Finance: DB status enum unchanged; mapping draft=draft, unpaid=sent, partial=partially_paid, paid=paid, cancelled=void, overdue derived at read time. Money = numeric in DB, integer minor units in TS (`src/lib/money.ts`, half-up once per line). Invoices/payments are never deleted (void/cancel). Numbering INV-{workspace-local year}-{0001}.
- Work: Lead -> Quote -> Job (+Project) conversions are SECURITY INVOKER SQL functions, idempotent (unique indexes uq_quotes_lead, uq_jobs_quote); links derived (quotes.lead_id, jobs.quote_id) to avoid circular FKs; `invoices.quote_id/job_id/project_id` carry the Work-Finance relation.
- Waiting list: no automatic booking; "Book appointment" opens Calendar create with client name + date prefill only.
- Inbox: events from appointment triggers (created / rescheduled / cancelled / confirmed / completed / no-show), dedupe key appointment:<id>:<status>:<starts_at epoch>; `recordInboxEvent` service helper exists for waiting/work/finance events but Work and Finance do NOT call it yet (backlog). `is_read` is workspace-wide, not per user. Conversation UI stays demo-only.
- Analytics: `analytics_overview(workspace, from, to)`; revenue = non-voided payments by paid_at day (cash view); work pipeline is a snapshot; sections the caller may not see are omitted from the response.
- Cross-module: client detail "Related" panel (work + invoices) for permitted viewers on real workspaces.
## Advisor note
`can_access_invoice_row`, `can_see_work_row` (RLS helpers) and `next_invoice_number`, `record_inbox_event` (permission-checked RPCs) are executable by `authenticated` on purpose: 4 new intentional SECURITY DEFINER warnings (11 total with the 7 older helpers). anon cannot execute any of them.
## Known limitations
Invoice update is two calls (items, then fields); lead/quote currency fixed to EUR in the Work UI; inbox nav unread badge not wired (`getInboxUnreadCountAction` exists); no event for a freed slot matching a waiting-list entry; Work conversions and Finance do not yet emit inbox events; private-appointment inbox events are visible (generic text) to all members with appointments.view; PGlite tests prove idempotency/constraints but not true multi-connection row-lock concurrency.
