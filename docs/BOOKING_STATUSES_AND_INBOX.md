# Booking statuses, cancelled appointments, Inbox events, feature flags

Branch `feature/booking-status-inbox-ux`. Decisions agreed with the team: 1A, 2A, 3A, 4A.

## 1. Status model (single source: `src/features/appointments/statusRules.ts`)

The UI (chips, quick actions) and the server (`appointments.service.ts`) call the
SAME functions; the server is authoritative (`invalid_status_transition`).
"Now" is the **workspace wall clock** (`wallNow(timezone)`), demo = machine clock.

| Status | Blocks time | Meaning | Allowed when |
|---|---|---|---|
| pending / confirmed | yes | planned | always (create) |
| checkedIn / inProgress | yes | client is here | from the day of the appointment |
| completed | no | took place | only after the start (or from checkedIn / inProgress) |
| noShow | no | client didn't come | only after the start, from pending / confirmed / completed |
| cancelled | no | called off | only BEFORE the start, from pending / confirmed |
| rescheduled | — | legacy value, never chosen | never (a move keeps the row and changes the time) |

Corrections: noShow → completed / confirmed, completed → noShow / confirmed,
cancelled → confirmed (future only; the slot is re-checked for conflicts).
Every status change is audited; a change away from an outcome is marked
`(correction)`. Moving is allowed only for active, not-yet-started-outcome rows.

## 2. Calendar

- Cancelled-like appointments are hidden by default; the "Show cancelled"
  chip shows them muted (dashed, line-through, status text). Remembered per
  browser (localStorage, optional).
- No-show is always shown, muted, with its status.
- Conflicts and deep links still use the full list; cancelled rows never
  block time (DB exclusion constraints + `ACTIVE_STATUSES`).

## 3. Physical delete (only "created by mistake")

Allowed only for **owner / admin**, and only if the appointment has no outcome
(completed / no-show / checked in / in progress), was created in the business
app (`source = 'user'`), and has no invoice / waiting-list link. Otherwise the
form explains why and offers cancelling (if still possible).
Server: `getDeleteBlockers` + `removeAppointment`. Database (0027):
`guard_appointment_delete` enforces the same, including rows RLS hides
(private invoices, client-account booking claims). Workspace deletion
(cascade) is not blocked.

## 4. Inbox events (migration 0027 — NOT applied to production)

`inbox_events.details` (jsonb, ≤ 4 KB) — snapshot at the moment of the change:
client name/id, service, staff, `starts_at`, `old_starts_at` (reschedule),
duration, timezone, `status`, `old_status`, `initiator {kind, role, name}`.

- **Private / owner-only / custom** appointments: no client, no service, empty preview.
- **Old events** keep `details = {}` → the UI shows the old preview labelled
  "Appointment time"; nothing is back-filled or guessed.
- **Dedupe**: `appointment:<id>:<code>:<txid>` → one event per change, but
  A → B → A creates separate events (before: the second one was swallowed).
- **Initiator**:
  - `business_user` — `auth.uid()` is a member of THIS workspace (role + profile name);
  - `client_online` — no `auth.uid()`: only the guest booking RPC and the
    client-account RPCs (`cancel_my_booking`, `reschedule_my_booking`, they
    require the signed-in client's claim) write appointments as service role;
  - `unknown` — `auth.uid()` set but not a member (should not happen);
  - `serviceos.actor_kind` (transaction-local setting) overrides, for future automation (`system`).
  A guest vs. a signed-in client on the *first* booking cannot be told apart
  without changing the RPCs → both are "client (online)".
- RLS on `inbox_events` is unchanged (select needs `appointments.view` in the same workspace).
- Retention: none yet (open question, proposal: 12 months).

UI (`InboxEventsView`): search (client / service / staff / old preview), type
filter, read/unread filter, newest/oldest, groups by day (workspace timezone),
"Was → Now" for reschedules, appointment time separate from change time,
links to the appointment (calendar opens on its day) and to the client.
Works without 0027 (events simply have no snapshot).

## 5. Feature flags (Finance, Analytics) — `src/lib/config/features.ts`

`SERVICEOS_FEATURES` (server env, comma list):

| Value | Result |
|---|---|
| not set + `next dev` / tests | both on |
| not set + production build (Vercel production AND preview) | both off |
| `finance,analytics` | both on |
| `finance` | only finance |
| `""` | both off |

Off means: hidden in Sidebar / More / Quick create, `notFound()` on the pages,
every finance / analytics Server Action answers `not_found`, the Today
"Outstanding" card and the client's invoice section disappear, no invoice
requests are made. Code, tables, data and calendar price / paid stay.
Re-enable: set the variable in Vercel and redeploy.
