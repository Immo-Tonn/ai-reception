# Data Retention & Cleanup

**All periods are PROVISIONAL until legal review (Needs legal review).** Scope: §1–§5 the Google Calendar
integration (migrations 0025/0026); §6 client data (GDPR stages 1–5, migrations 0028–0032, see
[GDPR_IMPLEMENTATION_PLAN.md](GDPR_IMPLEMENTATION_PLAN.md)). Supabase Auth accounts are not covered here (separate
work). Open legal questions: [LEGAL_TODO.md](LEGAL_TODO.md).

## 1. Retention per data type
| Data | Where | Kept | Deleted by |
|---|---|---|---|
| Encrypted refresh token | `external_calendar_connections.refresh_token_ciphertext` | while connected | disconnect, deactivation, revocation at Google (wiped) |
| Selected calendar ids (often the e-mail address) | `…calendar_ids` | while connected | disconnect, deactivation, revocation at Google (wiped) |
| Pseudonymised Google account id (HMAC of `sub`) | `…google_subject_hash` (0026) | while the row exists (also in "revoked" state, so the person can resolve it on the manage page) | disconnect, deactivation |
| Status, last success / error code and time | `…status`, `last_*` | while the row exists | disconnect, deactivation |
| Busy cache (start/end only, now-1 d .. now+183 d) | `…busy_intervals` + window/fetched columns | replaced on every refresh (<= every 5 min while used) | daily cleanup when not refreshed for **24 h**; disconnect; revocation |
| Connect-link record (SHA-256 hash, expiry, used_at, creator) | `external_calendar_invites` | 72 h validity | daily cleanup **30 days after use**, or **30 days after expiry** if unused |
| OAuth flow / setup / manage cookies | browser (sealed, httpOnly) | 10 / 30 / 15 min | expiry; flow cookie deleted after the callback |
| Calendar names, event contents, raw `sub`, access tokens | — | never stored | — |
| Server logs (ServiceOS) | Vercel function logs | counts and error **names** only (no ids, e-mails, tokens) | Vercel log retention of the plan (Needs legal review) |
| Backups | see [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md) | until the backup is deleted | not instantly: deleted data remains in a backup until that backup is deleted |

## 2. Minimal technical status ("access withdrawn")
When Google answers `invalid_grant` (the person removed ServiceOS in their Google account, or the grant expired),
ServiceOS keeps only: workspace, staff profile, status `revoked`, error code + time, subject hash. Token, calendar
ids and busy cache are wiped immediately.

**This status is never deleted automatically.** While it exists the person is **not offered for booking** (their
busy time is unknown). Deleting it automatically would silently switch them back to the plain working schedule and
could open times that are busy in reality. It ends only by a human decision:
- the business disconnects (Settings -> Google Calendar), or
- the person disconnects on `/connect-calendar/manage`, or
- the person reconnects.
After an explicit disconnect the normal working schedule applies.

## 3. Rules after disconnect / deactivation
- **Disconnect (any path):** the row is deleted immediately. Google's grant is revoked only if no other ServiceOS
  connection of the same Google account remains (Google revokes account-wide). See EXTERNAL_CALENDAR.md §6.
- **Staff deactivated:** `setStaffActive(false)` removes the connection immediately (best effort); the daily cleanup
  removes anything left behind. An inactive person is never bookable, so this never opens time.
- **Staff or business deleted:** `on delete cascade` removes connections and links.

## 4. Automatic cleanup (Vercel Cron)
| Item | Value |
|---|---|
| Route | `GET /api/cron/external-calendar-cleanup` |
| Schedule | `vercel.json`: `17 3 * * *` (daily, 03:17 UTC). The hosting plan limits cron frequency and precision (see the Vercel documentation) |
| Auth | `Authorization: Bearer <CRON_SECRET>` (Vercel sends it when `CRON_SECRET` is set); timing-safe compare; **closed** (401) when no secret or a secret shorter than 16 chars is configured |
| Steps | 1. clear busy caches not refreshed for 24 h · 2. delete used links older than 30 days · 3. delete unused links expired > 30 days · 4. remove connections of inactive staff |
| Idempotent | yes — a repeated or late run deletes nothing twice |
| Failures | each step independent; a failing step is listed by name in `failedSteps`, the others still run; HTTP 500 if any step failed |
| Logging | `[calendar cleanup] {"staleCachesCleared":n,…}` — counts only |
| Response | the same counts as JSON |

Clearing a cache never opens busy time: the next booking request asks Google again; if Google fails, the person is
blocked (fail-closed). Tested in `externalCalendarIntegration.test.ts` ("retention cleanup").

Vercel cron limits depend on the hosting plan (see the Vercel documentation); cron invocations count as normal function usage.

## 5. Open DSGVO questions (Needs legal review)
- Final periods: 24 h cache, 30 days for link records, "revoked" status without automatic deletion.
- Legal basis and roles (employer business vs ServiceOS operator), information of staff (Art. 13), record of
  processing, DPIA.
- Backup retention and handling of deletion requests for data in backups.
- Hosting function region and log retention; processor agreements with Supabase/Vercel (details: private repository).
Full list: [LEGAL_TODO.md](LEGAL_TODO.md).

## 6. Client data (GDPR stages 1–5) — provisional
None of the periods below is a legal requirement or approved; all **Need legal review**. Nothing is deleted or
anonymised automatically: `AUTO_ANONYMIZE_ENABLED` / `INBOX_RETENTION_DELETE_ENABLED` activate nothing.

### 6.1 Categories when a client is anonymised (owner action, migration 0028)
| Category | Data | Action |
|---|---|---|
| A — removed | client e-mail, phone, tags, notes; appointment client / internal notes and title; waiting-list contact data and notes; Inbox previews / client snapshots; notes of leads, quotes, jobs, projects; the link of the client's appointments to a client account (booking claim unlinked, token expired) | emptied |
| B — pseudonymised | client name; name copies in waiting list, leads, quotes, jobs, projects | replaced by `Gelöschter Kunde` |
| C — kept | invoices (incl. the name on the invoice), amounts, appointment dates / services / prices / statuses, internal ids | unchanged (retention of business records — Needs legal review) |
Not covered: Supabase Auth user and `client_accounts` (other developer), the account's ICS feed, backups (§6.4),
the business user's local browser history (localStorage).

### 6.2 Periods and mechanisms
| Item | Provisional value | Where | Effect today |
|---|---|---|---|
| Client data period | **36 months** after the last completed visit, per workspace **12–120 months** (`workspaces.client_retention_months`, owner only) | migration 0031, Settings → Data retention | dry-run count only |
| Clients without a completed visit | reported separately (created before / after the cutoff) | dry run | count only, never a candidate |
| Blockers | future appointment, open appointment status, active waiting-list entry, open lead / quote / job / project, open invoice (a paid / cancelled invoice is not a blocker) | dry run | count only |
| Inbox notifications | **12 months**; unread and open-process ones counted separately | dry run | count only |
| Booking claims never claimed | deleted **30 days** after expiry, max 500 per run; claimed, valid and open-appointment claims kept | daily cron (§4, step 5) | **real deletion** |
| Archive | reversible, only `clients.archived_at` | migration 0032 | hides from active work; nothing deleted |

### 6.3 Access requests and export (migration 0029)
Export of one client (owner / admin, JSON, `Cache-Control: no-store`, nothing stored, internal notes owner-only
after a legal check). Register `data_subject_requests` keeps metadata only (type, dates, status, identity
checked, responsible, categories). The Art. 15 block contains placeholders until the legal wording is provided.

### 6.4 Backups
Deleted / anonymised data stays in a backup until that backup is deleted. After restoring an older backup the
anonymisations must be re-applied — see [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md) §7.

### 6.5 Health data
Notes fields show "Do not enter health information" (client, appointment and waiting-list notes). Health data is a
special category (Art. 9 GDPR); the app has no process for it. Needs legal review.
