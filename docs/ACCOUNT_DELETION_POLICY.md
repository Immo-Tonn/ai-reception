# Account deletion & anonymization — proposed policy

**Status: PROPOSAL for the team to approve.** Nothing here is implemented yet. Numbers are defaults,
kept as named constants in code so changing them is a one-line edit. This is not legal advice; have it
reviewed before real customers and real invoices are on the platform.

## 1. Product position (needs a team decision)

ServiceOS is a tool for **online booking, managing and monitoring appointments and staff work**.
Prices, payments and invoices in the app are for the business's own day-to-day control and internal
statistics. ServiceOS is **not** the business's official accounting system; the business keeps its legal
books in its own licensed software. If the team agrees, say so in the Terms and the Datenschutz.

Consequence: personal data of a client is not held "for ServiceOS's tax duties", so a client's erasure
request can be honoured by anonymization without waiting for any retention period of our own.

## 2. Client deletes their account

| Step | When | What happens |
|---|---|---|
| Request | Client confirms in the client area (password or e-mail code) | Signed out; future appointments are **cancelled** (the business sees "cancelled by client"); the account is marked "deletion pending" |
| Grace period | `CLIENT_DELETION_GRACE_DAYS = 30` | Signing in again cancels the request; nothing else is lost |
| Anonymization | After the grace period (scheduled job) | Login and `client_accounts` row deleted; the client card at **every** business linked to the account is anonymized (name -> "Deleted client", e-mail, phone, notes cleared); inbox snapshots of that client are scrubbed (`forget_client_in_inbox`) |
| Kept | Always | The appointment itself (date, service, staff, status, amount) without a person attached, so the calendar and the business's own statistics stay consistent |

A guest who never made an account uses the same erasure through an **e-mail-code confirmed request**
(the one-time-code mechanism already used for password recovery).

## 3. Owner deletes the business

| Step | When | What happens |
|---|---|---|
| Request | Owner only; types the workspace slug; password re-entered | Business becomes unavailable (booking page, directory, sign-in of staff); owner can restore it |
| Grace period | `BUSINESS_DELETION_GRACE_DAYS = 30` | Data is kept untouched |
| Deletion | After the grace period (scheduled job) | The `workspaces` row is deleted; everything else follows by `ON DELETE CASCADE` (appointments, clients, services, staff, invoices, inbox, calendar connections). The owner's login stays |
| Before it | Optional, later | Owner can export clients and appointments as a file |

Notes: the appointment delete guard (0027) does not block a whole-workspace cascade; a connected
Google Calendar grant should be revoked at Google before the row is removed (separate task); backups
keep deleted data until they expire (state this in the Datenschutz).

## 4. Technical outline (no `service_role`)

- Each operation is a SQL function (`security definer`, pinned `search_path`) that acts only on
  `auth.uid()`; migrations are applied by hand after the team agrees on their numbers.
- Needs one scheduled job for the grace-period finalization (Vercel Cron, as in the calendar branch).
- A login that still owns a business cannot be deleted: delete the business first.

## 5. Inbox journal ("ghost" events)

Inbox events are snapshots written by a database trigger when an appointment is created, moved or
cancelled. Deleting an appointment (allowed for entries created by mistake) leaves its events behind,
and they still carry the client's name in `preview` and in the snapshot. Proposal:

1. Write a "booking deleted" event when an appointment is physically deleted, so the journal stays honest.
2. Optionally dim or hide events whose appointment no longer exists.
3. Retention: old events are removed automatically (PR #8 already adds an inbox retention setting).
4. Client anonymization also scrubs the name from `preview` and the snapshot (`forget_client_in_inbox`).

To be coordinated with PR #8 (`booking-status-inbox-ux`) so the work is not duplicated.

## 6. Open points

1. Grace periods: 30 days proposed (not 6-24 months: a long keep-everything period is hard to justify for
   data nobody uses).
2. Business deletion restore window: same 30 days?
3. Export before deletion: required for launch or later?
4. Final wording for Terms / Datenschutz (backups, "not an accounting system").
