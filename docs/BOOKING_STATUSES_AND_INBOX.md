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
`(correction)`.

**Who may correct:** changing a RECORDED outcome (completed / no-show /
cancelled, incl. restoring a cancelled appointment) needs the permission
`appointments.correct` = **owner, admin, manager**. Staff may set the first
outcome (check-in, completed, no-show) but not change it afterwards.
Enforced three times: UI (buttons hidden, hint shown), service
(`assertStatusChange` → `forbidden`), database (0027 trigger
`guard_appointment_history`, also against direct API calls). Every correction
is in the audit log (app) and creates an Inbox event with old/new status and
the initiator (database, 0027). Moving is allowed only for active, not-yet-started-outcome rows.

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

## 4. Inbox events (migration 0027 — applied to production 2026-10-23)

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
- **Client erasure** (0027 `forget_client_in_inbox`): deleting a client removes
  their name / id from all Inbox snapshots and previews of that workspace; the
  events stay without personal data.

### Retention of Inbox notifications (agreed: 12 months, NOT active)

- Setting: `INBOX_RETENTION_MONTHS` (server env, whole months 1–120, default 12),
  `src/lib/config/inboxRetention.ts`.
- **Automatic deletion is not implemented and not switched on**
  (`INBOX_AUTO_DELETE_ENABLED = false`). It needs a separate approval and a
  legal review of the period (Needs legal review). Until then nothing is deleted.
- Scope = notifications ONLY. Not affected, ever: `appointments` (the client's
  booking history, statuses, no-show counters), `audit_logs` (who changed
  what), `invoices` / `payments` (German retention duties of the business,
  typically 6–10 years — Needs legal review), `waiting_list`, `clients`.
- Dependencies checked: no table references `inbox_events` (no foreign keys
  into it); the audit log does not read it; the client card and analytics do
  not read it. Deleting an old notification therefore changes no history.
- Datenschutz: notifications contain personal data (client name in the
  snapshot), so a fixed period supports data minimisation (Art. 5 (1) e DSGVO).
  The Datenschutzerklärung must name the period once it is final; after PR #7
  is merged, add a row to `docs/DATA_RETENTION.md`. Backups keep deleted rows
  until the backup itself expires.
- When approved later: a daily, idempotent job (e.g. next to the cleanup cron
  of PR #7) deletes `inbox_events` older than `inboxRetentionCutoff(months)`,
  logs counts only, with a dry-run first.

UI (`InboxEventsView`): search (client / service / staff / old preview), type
filter, read/unread filter, newest/oldest, groups by day (workspace timezone),
"Was → Now" for reschedules, appointment time separate from change time,
links to the appointment (calendar opens on its day) and to the client.
Works without 0027 (events simply have no snapshot).

## 5. Feature flags (Finance, Analytics) — `src/lib/config/features.ts`

In plain words: `SERVICEOS_FEATURES` is a list of the unfinished modules that
are switched ON for one deployment. It is read on the server when a page is
rendered or an action is called. Nothing is deleted when a module is off; it
is only hidden and locked.

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

### Recommended setup per environment

| Environment | Database | `SERVICEOS_FEATURES` | Who sees Finance / Analytics |
|---|---|---|---|
| Local (`next dev`) with the LOCAL Supabase (`supabase start`) or demo workspaces | test data | unset (= on) | the developer |
| Staging with its OWN test Supabase project (does not exist yet) | test data | `finance,analytics` | the team |
| Vercel Preview | **production data** (shares the production keys) | **unset (= off)** | nobody |
| Production (`livetermin.de`) | production data | **unset (= off)** | nobody |

⚠️ "ServiceOS Dev" is the Supabase project that serves PRODUCTION (real
businesses). It is not a test database. Until a separate test project
exists, Finance / Analytics are tested only locally.

Rules:
- Turn the modules on only where the database holds TEST data. The flag does
  not decide which data is visible — the Supabase project of the environment
  does. RLS still applies everywhere (a business only sees itself; finance
  only for roles with `finance.view`).
- Never point staging / previews at the production database to "test finance".
- Later, to launch: set `SERVICEOS_FEATURES=finance,analytics` (or only one)
  in the production environment and redeploy. Removing it hides them again.

## 6. Status of the rollout (2026-10-23)

1. ✅ PR #7 (Google Calendar) merged into `main`.
2. ✅ `main` merged into this branch; the three conflicts resolved by keeping
   both sides; tsc, all tests (1160) and the build pass.
3. ✅ Migration **0027 applied to production** after a fresh encrypted backup
   and an isolated restore + apply test (only `role_permissions` +3 rows,
   every other table unchanged, Auth 11/11). Migration history 0001–0027 is
   in order, `supabase db push --dry-run` reports "up to date".
4. ⏳ Merge **PR #8** (team lead). No SQL, no conflicts, no ENV change needed.
