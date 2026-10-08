# Staff, resources, working hours, time off, booking rules (migration 0019)

Authoritative design for this stage. Extends what exists (staff_profiles, services, service_staff,
resources, working_hours, appointments + exclusion constraints from 0011, the shared availability
engine in `src/features/appointments/availability.ts`). No second engine, no parallel tables.

## Domain model
```
workspace ─┬─ staff_profiles (title, sort_order, schedule_mode inherit|custom, active, profile_id? -> future link to a login)
           ├─ services ── service_staff (who performs)   ── service_resources (which resources it may use)
           ├─ resources (type, description, sort_order, active)
           ├─ working_hours (staff_id NULL = business; several intervals per weekday; is_day_off = closed)
           ├─ time_off (staff_id NULL = business closure; full day(s) or one partial day; private reason)
           └─ booking rules (columns on workspaces)
appointments: workspace_id, service_id, staff_id, resource_id, starts_at/ends_at, timezone, busy_from/busy_until (buffers), status
```
Staff Member != authenticated user. `staff_profiles.profile_id` stays the future link; no invitations now.
Capacity of a resource is 1 (an exclusive reservation); no inventory.

## Rules
- Hard delete of a staff member, resource or service that appointments reference is forbidden by a DB trigger
  (archive = `active=false`). History keeps its ids; deactivated entities still resolve for display.
- Service needs a resource iff `services.required_resource_type` is set. Candidates = resources linked in
  `service_resources` for that service if any link exists, otherwise all active resources of that type.
- Working hours: business rows (`staff_id IS NULL`) define opening hours. A staff member with
  `schedule_mode = 'inherit'` works exactly the business hours; `'custom'` uses their own rows. Effective staff
  hours = business hours INTERSECT staff hours (a custom schedule can only narrow, never open a day the business is
  closed). Several non-overlapping intervals per weekday are allowed; a day-off row excludes intervals that day.
- Time off: business closure and staff time off are subtracted. Full day(s) or one partial day.
- Booking rules on `workspaces`: `auto_confirm_bookings` (existing), `min_notice_minutes` (0), `max_horizon_days` (90, 1..180),
  `slot_interval_minutes` (15; 5,10,15,20,30,60), `cancellation_deadline_hours` (0), `reschedule_deadline_hours` (0).
  Buffers stay per service (`buffer_before/after_minutes`) and are part of the busy window.
- Start times lie on the clock grid of `slot_interval_minutes` (09:00, 09:15, ...) and the whole service must fit.

## Availability (ONE engine, server-authoritative)
A slot for (service, staff?, date) exists iff: public booking enabled; date within [today, today+horizon] and start >= now+minNotice
(workspace timezone); eligible active staff (service_staff, active); start+duration inside business intervals AND staff
intervals (inherit/custom); no time off (business or staff, full or partial); no appointment conflict for the staff (with
buffers); required resource free (candidates per rule above); all computed in the workspace timezone (`zonedTime.ts`).
Callers: public booking slots/dates, client reschedule, business calendar suggestions/conflict check - all through
`computeSlotsFor` / `checkSlotAvailable`. The browser only displays; the server recomputes before writing; the database
exclusion constraints (staff and resource windows) are the final judge under concurrency (23P01 -> slot_unavailable).
Database also enforces min notice / horizon in `create_public_booking` / `reschedule_my_booking` and the cancel/reschedule
deadlines in `cancel_my_booking` / `reschedule_my_booking`. Working hours and time off are enforced by the server engine
(the business may deliberately book outside them from the Calendar).

## Auto-confirm
Public booking status = `confirmed` if `auto_confirm_bookings` else `pending`, decided inside `create_public_booking`
AFTER the server validated the slot. Business-created appointments keep the status the business chooses. A client reschedule
returns to `pending` unless auto-confirm.

## Security
All new tables: RLS on, members read (`is_workspace_member`). Writes: `time_off` and `service_resources` need `staff.manage`;
`working_hours`, `resources` and `service_staff` keep their existing `settings.manage` policies (0009/0016); the services layer
therefore requires BOTH `staff.manage` and `settings.manage` for staff/resource/hours writes (owner and admin hold both;
manager/staff are denied); booking rules need `settings.manage` (existing workspaces policy). Anonymous gets only what the service-role public
RPC returns: active staff (id, name, title), active resources (id, name, type), service links, working hours, time off WITHOUT
reasons, and the three public rules (min notice, horizon, slot interval). Internal columns never leave.

## Demo
Demo presets keep `WorkspaceConfig` (staff, resources, working hours, bookingRules optional); same domain types, read-only
settings pages. Demo and real never mix.

## Known limitations (by design for now)
No per-resource capacity, no staff-specific buffers, no recurring time off, no per-day exceptions to weekly hours besides time off,
working hours / time off are not DB-enforced against business-created appointments, no invitation/roles UI, no holidays calendar.

## Implementation notes (as built)
- Migrations: `0019_staff_scheduling.sql` (schema, RLS, triggers, public RPCs, booking rules in create/cancel/reschedule),
  `0020_replace_working_hours.sql` (SECURITY INVOKER function: replace one owner's whole week atomically; RLS and triggers still apply).
- Resource <-> service rule: linking a resource sets `services.required_resource_type` to the resource's type when the service has none;
  a different type is refused (`resource_type_mismatch`); unlinking never clears the type (falls back to all active resources of the type);
  a resource that still has links cannot change type.
- Staff `schedule_mode`: `inherit` = business hours; `custom` = own rows (a custom staff member with no rows is closed). `inherit` keeps
  old custom rows (ignored until switched back).
- Time off: full days or one partial day; partial multi-day entries are expanded per day by the mapper (cap 366). Reasons stay private
  (never in the public catalog or in audit summaries).
- Engine: `src/features/appointments/availability.ts` + `src/features/workingHours/logic.ts` + `src/features/scheduling/*`
  (interval math, available dates); server wrappers in `src/server/booking/publicBooking.service.ts`; business read model in
  `workspaceCatalog.service.ts`; write side in `src/server/services/{staffAdmin,resourcesAdmin,workingHours,bookingRules}.service.ts`.
- UI: `/[slug]/settings/{staff,resources,hours,booking}`; demo workspaces get the same pages read-only.
- Business-created appointments may still be booked outside hours (the Calendar warns/blocks through `checkSlotAvailable`; the DB only
  guards overlaps).
## Additional limitations
Deactivating staff/resources does not warn about their future appointments; audit summaries are English; capacity 1; no staff-specific
buffers; slot grid is on the clock (multiples of the interval since midnight); horizon default 90 days (was effectively 180).
