# Proposed migration: services (NOT applied, NOT in supabase/migrations)

Current schema already has `services.active` and `service_staff`, so archive and staff
assignment work without a migration. Only the items below need one.

## 1. Service description — NOW INCLUDED in 0017 (kept here for the wiring notes)

```sql
alter table public.services
  add column if not exists description text not null default '' check (char_length(description) <= 1000);
```

After applying: add `description` to `ServiceRow`/`serviceFromRow`/`serviceToRow`, to
`createServiceSchema`, `ServiceDefinition`, the form in `ServicesView.tsx`, and (optionally) the
`services` JSON in `public.get_public_catalog` (0013) so public booking can show it.

## 2. Optional hardening: keep history if a service is ever hard-deleted

`appointments.service_id` is `on delete set null`, so a hard delete blanks the service on past
appointments. The app now only archives (`active = false`), so this is defensive only. Option:
snapshot the name on the appointment.

```sql
alter table public.appointments add column if not exists service_name text;
-- backfill: update public.appointments a set service_name = s.name from public.services s where s.id = a.service_id;
-- then set it from services in the existing busy-range/insert trigger or in create_public_booking.
```

## 3. Optional: block bookings of inactive services in the database

Public booking already checks `s.active` (0013). The business-side check lives in
`appointments.service.ts` (`service_inactive`). A DB-level guard would extend
`guard_workspace_references` (0011) to reject inserts with an inactive `service_id`.
