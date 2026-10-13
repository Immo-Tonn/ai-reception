# External calendars: Google Calendar FreeBusy (one direction)

Status: **implemented and tested with a mock provider and fake HTTP responses; NOT yet verified against a real Google
account.** Migration `0025` is written but NOT applied to any shared database. Setup guide for the owner (Russian):
[GOOGLE_CALENDAR_SETUP_RU.md](GOOGLE_CALENDAR_SETUP_RU.md).

## What it does
- Each staff member can connect **their own** Google account and choose which calendars count (1-10).
- Busy time in those calendars is removed from **that person's** bookable slots. Other staff are unaffected.
- One direction only: Google -> ServiceOS availability. ServiceOS never writes to Google, Google never changes
  ServiceOS appointments. ServiceOS stays the source of truth for bookings.
- Only start/end of busy blocks are read (FreeBusy API). No titles, descriptions, attendees, locations.
- Clients only ever see "this time is not available".

## Architecture (docs/PRODUCT_ARCHITECTURE.md §4.3)
```
public booking / dates / client reschedule / business create-update-move
        │ (ExternalBusyLoader: workspaceId, [from, until), mode browse|commit, staffIds?)
        ▼
ExternalCalendarService  (src/server/externalCalendar/service.ts)  — cache policy, fail-closed, OAuth flow
        │                                   │
CalendarProvider (provider.ts)       ExternalCalendarStore (store.ts, service role, migration 0025)
   ├─ GoogleCalendarProvider (googleProvider.ts, REST + fetch, no SDK)
   └─ MockCalendarProvider   (mockProvider.ts, tests)
        ▼
externalBusyForEngine (engineInput.ts) -> busyRangesToAppointments -> THE availability engine
   computeSlotsFor / computeAvailableSlots / checkSlotAvailable (externalBusy, externalUnavailableStaffIds)
```
No second slot engine: external busy time is one more input of `src/features/appointments/availability.ts`
(reasons `externalBusy` / `externalUnconfirmed`). It blocks only the person, never a resource; the candidate
service's own buffers still apply.

### Every path that offers or writes a time
| Path | Where | Mode |
|---|---|---|
| Public slots | `computeSlots` (publicBooking.service.ts) | browse |
| Public available dates | `computeAvailableDatesForCatalog` | browse |
| Public booking (final check before `create_public_booking`) | `createPublicBooking` | **commit** |
| Client reschedule slot list | `getRescheduleSlots` -> `computeSlots` | browse |
| Client reschedule (final check before `reschedule_my_booking`) | `rescheduleMyBooking` | **commit** |
| Business create / update / move | `checkBusinessRules` (appointments.service.ts) | **commit** |

Business update/move checks Google only when the slot itself changes (date, time, person, duration, service,
re-activation). Editing notes/status of an appointment that now overlaps a Google event stays possible.
Pinned by `externalCalendarWiring.static.test.ts`.

## Policy (src/features/externalCalendar/policy.ts)
| Rule | Value |
|---|---|
| Cached window per connection | now - 1 day ... now + 183 days (covers the max 180-day horizon) |
| Browse freshness | 5 min |
| Commit freshness (right before writing) | 60 s |
| Stale cache still trusted when Google fails | up to 15 min |
| After that | person is **unconfirmed**: no slots, business cannot book them; everyone else bookable |
| Back-off after a failed refresh (browse only) | 60 s |
| Parallel refreshes | one per connection (DB claim, 30 s) |
| Provider request size | chunks of <= 60 days, <= 10 calendars, 6 s timeout per call |
| Revoked access (`invalid_grant`, 401) | status `revoked`, token wiped, person unconfirmed until reconnect or disconnect |
| Google not configured / key missing | connected people unconfirmed (never silently free) |
| Undecryptable token (key changed) | status `error` / `not_configured`, row kept (never wiped by a config mistake) |
| Outside the cached window (business books > 6 months ahead) | direct uncached request; failure = unconfirmed |
| Migration 0025 not applied yet | "no connections" (nothing can be connected without the table), booking unchanged |

No answer from Google is never read as "free". Concurrency: the database exclusion constraints only know
ServiceOS appointments; the commit re-check narrows the window in which a just-created Google event could be
missed to seconds. Double booking WITHIN ServiceOS stays impossible (unchanged).

Conflicts (a ServiceOS appointment overlapping new Google busy time) are listed in Settings -> Google Calendar
for owner/admin (private appointments without service details). ServiceOS never cancels or moves them.

## Connecting (staff accounts do not exist yet)
1. Owner/admin (`staff.manage`), or the person whose staff profile is linked to the signed-in user
   (`staff_profiles.profile_id`, e.g. the owner's own profile), creates a **single-use connect link** (72 h).
   Only the SHA-256 hash is stored; a new link expires older unused ones.
2. The person opens `/connect-calendar/<token>` (noindex, no-referrer, no-store), reads what is accessed and
   continues to Google. Server Action -> sealed httpOnly cookie with OAuth `state` + PKCE verifier (10 min).
3. Google consent (authorization code + PKCE S256, `access_type=offline`, `prompt=consent`). Scopes:
   `calendar.freebusy` + `calendar.calendarlist.readonly` only. No `openid/email/profile`, nothing that writes.
4. `/api/integrations/google-calendar/callback`: state check (timing-safe), code exchange, both scopes required
   (granular consent), link consumed atomically, refresh token encrypted (AES-256-GCM, AAD = workspace+staff),
   previous grant revoked. Primary calendar selected by default.
5. `/connect-calendar/setup` (sealed 30-min cookie, only in that browser): choose calendars; names come live
   from Google and are never stored; only ids of calendars the account really has are accepted.

The owner never sees a token, calendar id or calendar name — only status, number of calendars, last successful
check, error code. Disconnect deletes the row (busy cache included) and revokes the grant at Google.

## Storage (migration 0025)
`external_calendar_connections` (one per staff member; encrypted refresh token, calendar ids, busy cache as
`[{start,end}]`, status, last success / error) and `external_calendar_invites` (token hash, expiry, used).
RLS on with **no policies**, all privileges revoked from anon/authenticated: service role only, callers authorize
first (`src/server/externalCalendar/deps.ts` is on the service-role whitelist). Same-workspace guard trigger.
Functions: `claim_external_calendar_refresh`, `issue_external_calendar_invite`, `consume_external_calendar_invite`.

## ENV (server-only)
`GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `EXTERNAL_CALENDAR_ENCRYPTION_KEY` (32 bytes base64).
Redirect URI = `<public base URL>/api/integrations/google-calendar/callback` (base URL from `NEXT_PUBLIC_APP_URL`;
Vercel preview URLs change per deployment and therefore cannot be registered — use a fixed staging domain).

## Known limitations
- Not verified with real Google yet; Google "Testing" mode refresh tokens expire after 7 days (shows as
  "Access withdrawn"); production needs Google OAuth verification (sensitive scopes).
- Calendar UI suggestions (`findNextAvailableSlot`, browser-side) do not know Google busy time; the server refuses
  such a time with a generic conflict message.
- Business error codes `external_calendar_busy` / `external_calendar_unconfirmed` reach the UI as the generic
  "conflict" text.
- No push notifications from Google (webhooks); freshness comes from the 5-min / 60-s policy.
- All-day "free" events (transparency) and declined events are handled by Google's FreeBusy semantics.
- GDPR: staff busy time is personal data of employees. Needs legal review (Datenschutz text, employee consent).
