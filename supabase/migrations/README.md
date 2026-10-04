# ServiceOS — PostgreSQL / Supabase migrations

These migrations are the **single source of truth** for the ServiceOS backend
structure: schema, constraints, indexes, functions, triggers and Row Level
Security all live here. Any Supabase project — the current test project or a
brand-new one — is reproduced by running them in order. See
`docs/BOOTSTRAP_NEW_SUPABASE.md`. Never edit an applied migration; add a new
numbered file.

## Order

Run in filename order (`0001` → `0018`); each depends on tables created
by the ones before it.

| File | Tables |
|---|---|
| `0001_workspaces_and_access.sql` | `profiles`, `workspaces`, `workspace_members`, `role_permissions` |
| `0002_people_and_catalog.sql` | `clients`, `staff_profiles`, `services`, `service_staff`, `resources`, `working_hours` |
| `0003_financial_buckets.sql` | `financial_buckets` |
| `0004_scheduling.sql` | `appointment_series`, `appointments`, `appointment_resources`, `waiting_list` |
| `0005_invoicing.sql` | `invoices`, `invoice_items`, `payments` |
| `0006_audit_log.sql` | `audit_logs` |
| `0007_onboarding_booking_mode.sql` | `workspaces.booking_mode` (idempotent) |
| `0008_workspace_hardening.sql` | `onboarding_completed_at`, reserved-slug rule (`is_slug_allowed`), `profiles.id → auth.users` FK, immutable slug/identity triggers (constraints `NOT VALID`) |
| `0009_rls_helpers_and_policies.sql` | RLS enabled on all tables, helper functions, Phase 1 policies (workspaces, members, profiles, services, staff, buckets, working hours) |
| `0010_provisioning_and_onboarding.sql` | `provision_workspace()` (service role only) and `complete_onboarding()` (user, RLS) |
| `0011_booking_integrity.sql` | `btree_gist`; `busy_from`/`busy_until` (trigger, includes service buffers); **EXCLUDE constraints** against staff and resource double booking; `appointments.resource_id`; cross-workspace reference guard triggers; `workspaces.auto_confirm_bookings`; normalized client phone |
| `0012_booking_rls_and_helpers.sql` | RLS for clients, appointments (Visibility enforced in the DB), resources, series, audit log; `can_see_appointment`, `list_masked_appointments`, `resolve_financial_bucket`, `workspace_financial_bucket_kinds` |
| `0013_public_booking.sql` | Guest booking API (service role only): `get_public_booking_catalog`, `get_public_busy`, `create_public_booking` (one transaction: validate, find-or-create client, insert appointment, audit) |
| `0016_security_hardening.sql` | Advisor fixes: no EXECUTE on trigger functions for PUBLIC/anon/authenticated; `btree_gist` moved to `extensions`; split `FOR ALL` write policies (closes an `admin` read of the PRIVATE financial bucket). **Apply after the first E2E, before production** |
| `0017_business_profile_and_discovery.sql` | Business profile columns, `public_booking_enabled` / `discoverable` (independent switches), service description, public profile in the booking catalog, `list_discoverable_businesses`. **Applied to Dev** |
| `0018_client_accounts_and_my_bookings.sql` | Client accounts (own-row RLS), per-appointment booking claims (hashed token, no client access), service-role RPCs for claim / list / cancel / reschedule. **Applied to Dev** |
| `0015_service_role_default_privileges.sql` | Default privileges for the service role on future tables/sequences (service role only; no change to anon/authenticated or RLS) |
| `0014_rate_limits.sql` | `rate_limits` table + `rate_limit_hit()` (PostgreSQL rate limiting, hashed subjects, service role only) |

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

## Applying

Empty project: run `0001` → `0018` in order (SQL Editor, or `supabase db push`).
`0001`–`0006` use `create type` without `if not exists`, so they run once, on
an empty database. `0007`–`0016` are idempotent. A project that already has
`0001`–`0006` needs only `0007`+.

Tests (`npm test`) replay every migration from scratch in an in-process
Postgres and exercise tenant isolation and role permissions
(`src/server/db/__tests__`). Seed/demo data is deliberately NOT part of the
migrations.
