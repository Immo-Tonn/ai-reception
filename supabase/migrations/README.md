# ServiceOS — PostgreSQL / Supabase migrations

Not connected to a real Supabase project yet — these are prepared ahead of
time so the swap from `src/server/repository/mockRepository.ts` to a real
Postgres adapter is a matter of implementing `Repository<T>` against these
tables, not designing a schema under pressure later.

## Order

Run in filename order (`0001` → `0006`); each depends on tables created
by the ones before it.

| File | Tables |
|---|---|
| `0001_workspaces_and_access.sql` | `profiles`, `workspaces`, `workspace_members`, `role_permissions` |
| `0002_people_and_catalog.sql` | `clients`, `staff_profiles`, `services`, `service_staff`, `resources`, `working_hours` |
| `0003_financial_buckets.sql` | `financial_buckets` |
| `0004_scheduling.sql` | `appointment_series`, `appointments`, `appointment_resources`, `waiting_list` |
| `0005_invoicing.sql` | `invoices`, `invoice_items`, `payments` |
| `0006_audit_log.sql` | `audit_logs` |
| `0007_onboarding_booking_mode.sql` | `workspaces.booking_mode` (adds a column, no new table) |
| `0008_booking_foundation.sql` | unique specialist names, one default schedule row per weekday, no-overlap constraint on `appointments` |

## Design notes that mirror the app layer

- Every table is `workspace_id`-scoped with an index on it — matches
  `src/server/repository/registry.ts`, where every mock repository is
  keyed by workspace.
- `appointments.visibility` and `appointments.financial_bucket_id` are
  **two independent columns** — see `src/server/services/masking.ts` and
  `src/server/permissions/roles.ts` for the application-layer half of
  this rule. Never collapse them into one `is_private` boolean.
- `role_permissions` is the SQL twin of `src/server/permissions/roles.ts`
  — when RLS policies are written, they read this table instead of
  duplicating the matrix in policy code.
- `audit_logs` columns match `src/features/auditLog/types.ts` field for
  field.

## Applied

`0001`–`0006` (plus the service_role GRANT fix and the `profiles.id -> auth.users.id` cascading FK) have been run against the live Supabase project via the SQL Editor — there is no `supabase` CLI link set up in this repo, so new migrations are applied the same way: run the new file's SQL directly in the project's SQL Editor.
