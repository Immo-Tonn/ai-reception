# Data Retention & Cleanup

**All periods are PROVISIONAL until legal review (Needs legal review).** Scope: the Google Calendar integration
(tables of migrations 0025/0026). Other ServiceOS data (clients, appointments, finance, auth) has no automatic
retention rules yet — that is a separate open item in [LEGAL_TODO.md](LEGAL_TODO.md).

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
| Schedule | `vercel.json`: `17 3 * * *` (daily, 03:17 UTC). Hobby plan: once per day max, run time ±59 min |
| Auth | `Authorization: Bearer <CRON_SECRET>` (Vercel sends it when `CRON_SECRET` is set); timing-safe compare; **closed** (401) when no secret or a secret shorter than 16 chars is configured |
| Steps | 1. clear busy caches not refreshed for 24 h · 2. delete used links older than 30 days · 3. delete unused links expired > 30 days · 4. remove connections of inactive staff |
| Idempotent | yes — a repeated or late run deletes nothing twice |
| Failures | each step independent; a failing step is listed by name in `failedSteps`, the others still run; HTTP 500 if any step failed |
| Logging | `[calendar cleanup] {"staleCachesCleared":n,…}` — counts only |
| Response | the same counts as JSON |

Clearing a cache never opens busy time: the next booking request asks Google again; if Google fails, the person is
blocked (fail-closed). Tested in `externalCalendarIntegration.test.ts` ("retention cleanup").

Vercel limits (docs, checked 2026-10-13): 100 cron jobs per project on every plan; Hobby: minimum interval once per
day, scheduling precision per hour; cron invocations count as normal function usage.

## 5. Open DSGVO questions (Needs legal review)
- Final periods: 24 h cache, 30 days for link records, "revoked" status without automatic deletion.
- Legal basis and roles (employer business vs ServiceOS operator), information of staff (Art. 13), record of
  processing, DPIA.
- Backup retention and handling of deletion requests for data in backups.
- Vercel function region (`iad1`, USA, per `x-vercel-id`) and log retention; Supabase/Vercel DPAs.
Full list: [LEGAL_TODO.md](LEGAL_TODO.md).
