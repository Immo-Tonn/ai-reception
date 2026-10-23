# Google Calendar Integration (FreeBusy, one direction)

**Status (2026-10-13):** implemented on branch `feature/google-calendar-freebusy`, tested with a mock provider,
fake HTTP responses and signed test ID tokens. **Not yet verified against a real Google account and not deployed.**
Migrations `0025` and `0026` are applied to the production database (ServiceOS Dev = production), 2026-10-13. Datenschutz text: Needs legal review.

Related: [Data retention](DATA_RETENTION.md) · [Backups & recovery](BACKUP_RECOVERY.md) ·
[Production checklist](PRODUCTION_DEPLOYMENT_CHECKLIST.md) · owner setup guide (RU) [GOOGLE_CALENDAR_SETUP_RU.md](GOOGLE_CALENDAR_SETUP_RU.md).

## 1. What it does
- Each staff member connects **their own** Google account and chooses which calendars count (1-10).
- Busy time in those calendars is removed from **that person's** bookable slots; other staff are unaffected.
- One direction only: Google -> ServiceOS availability. ServiceOS never writes to Google and Google never changes
  ServiceOS appointments. ServiceOS stays the source of truth for bookings.
- Only the start/end of busy blocks is read (FreeBusy API). Clients only see "not available".

## 2. Architecture
```
public slots / dates / booking · client reschedule · business create/update/move
        │  ExternalBusyLoader(workspaceId, [from, until), mode browse|commit, staffIds?)
        ▼
ExternalCalendarService (src/server/externalCalendar/service.ts)
  cache policy · fail-closed · OAuth flows · manage page · releaseGrant · cleanup
        │                                  │
CalendarProvider (provider.ts)       ExternalCalendarStore (store.ts, service role)
  ├─ GoogleCalendarProvider (googleProvider.ts, REST + fetch, no SDK)
  │    └─ idToken.ts (OIDC ID-token verification, Google JWKS)
  └─ MockCalendarProvider (mockProvider.ts, tests)
        ▼
externalBusyForEngine (engineInput.ts) -> THE availability engine (features/appointments/availability.ts:
  externalBusy / externalUnavailableStaffIds; reasons externalBusy / externalUnconfirmed)
```
No second slot engine. External busy time blocks the **person**, never a resource; the service's own buffers apply.

| Path | Where | Freshness |
|---|---|---|
| Public slots, available dates | `publicBooking.service.ts` | browse (5 min) |
| Public booking final check | `createPublicBooking` | commit (60 s) |
| Client reschedule list / final check | `clientAccount.service.ts` | browse / commit |
| Business create / update / move | `appointments.service.ts` (`checkBusinessRules`) | commit; update/move only when the slot changes |

## 3. Database (Supabase, service role only)
| Migration | Object | Purpose |
|---|---|---|
| 0025 (**applied**) | `external_calendar_connections` | one row per staff member: encrypted refresh token, selected calendar ids, busy cache (start/end only), status, last success/error |
| 0025 | `external_calendar_invites` | single-use connect links: SHA-256 hash only, expiry, used_at |
| 0025 | `guard_external_calendar_refs()` (trigger) | staff must belong to the same workspace |
| 0025 | `claim_external_calendar_refresh()` | one refresh at a time per connection + back-off |
| 0025 | `issue_external_calendar_invite()` / `consume_external_calendar_invite()` | new link expires older unused ones; atomic single use |
| 0026 (**applied 2026-10-13**) | `external_calendar_connections.google_subject_hash` + partial index | HMAC of the verified Google account id (`sub`) |

RLS is on with **no policies**; every privilege is revoked from `anon` / `authenticated`. Only server code with the
service role (`src/server/externalCalendar/deps.ts`, on the whitelist test) reads them, always after its own
authorization. Note: 0025 contains 4 functions (3 callable + 1 trigger function).

## 4. OAuth scopes
| Scope | Why | Sensitivity (Google) |
|---|---|---|
| `https://www.googleapis.com/auth/calendar.freebusy` | busy intervals only | Calendar scope (sensitive) |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | calendar picker (names shown live, never stored) | Calendar scope (sensitive) |
| `openid` | signed ID token with the stable account id `sub` | non-sensitive |

No `email`, no `profile`, nothing that writes. The manage page signs in with `openid` **only** (`access_type=online`,
no refresh token). Google's docs say a scope list "must begin with openid"; whether an `openid`-only request is
accepted must be confirmed in the first real test (fallback would need `email`, which requires a new decision).

## 5. Connecting
1. Owner/admin (`staff.manage`) or the person linked to the staff profile creates a **connect link** (72 h, single use).
2. `/connect-calendar/<token>` shows permissions, stored data, purpose, how to stop (no-referrer, noindex, no-store).
3. Server Action -> sealed httpOnly flow cookie (10 min): `state` (CSRF), PKCE verifier, OIDC `nonce`.
4. Google consent: code + PKCE S256, `access_type=offline`, `prompt=consent`, `include_granted_scopes=false`.
5. `/api/integrations/google-calendar/callback`: timing-safe state check; code exchange; all calendar scopes required;
   **ID token verified locally**: RS256 signature with Google's JWKS (discovery document, cached by `max-age`, one
   forced refresh on an unknown `kid`), `iss`, `aud`, `azp`, `exp`, `iat`, `nonce`; `sub` -> HMAC; link consumed
   atomically; refresh token encrypted (AES-256-GCM, AAD = workspace + staff). Primary calendar preselected.
6. `/connect-calendar/setup` (sealed 30-min cookie): choose calendars (only ids the account really has) or disconnect.

## 6. Disconnecting (any time)
| Who | Where | Effect |
|---|---|---|
| Owner/admin, or linked person | Settings -> Google Calendar | connection row deleted |
| Connecting person (30 min after connect) | `/connect-calendar/setup` | connection row deleted |
| Connecting person, **any time** | `/connect-calendar/manage`: "Sign in with Google" (openid) -> all connections of THAT account across businesses -> disconnect one / all (15-min sealed session, rate limited) | rows deleted |
| Staff deactivated | `setStaffActive(false)` + daily cleanup | row deleted |
| Revoked at Google by the person | detected on next refresh (`invalid_grant`) | token, calendar ids, busy cache wiped; minimal status kept |

**Shared Google grant.** Google's revocation removes all scopes and invalidates every token of that Google account
for our project at once. A person may be connected in several businesses with one account. `releaseGrant()` is the
only place that calls Google's revoke endpoint, and only when **no other** connection with the same subject hash
remains. Same account reconnecting: no revoke (it would kill the new token). Rows without a subject hash (made before
0026): not revoked (cannot attribute the grant) — the person can remove access in their Google account. The UI and
Datenschutz explain this.

Identity is never decided by e-mail or calendar id — only by the HMAC of the signature-verified `sub`.

## 7. Behaviour of availability per state
| State | Booking behaviour |
|---|---|
| Never connected / explicitly disconnected | normal working schedule |
| Connected, busy confirmed (cache <= 5 min browse / <= 60 s commit) | schedule minus Google busy time |
| Google unreachable: cache <= 15 min old | last known busy time used |
| Google unreachable > 15 min, not configured, key missing, outside cached window and request fails | person **unconfirmed**: no slots, business cannot book them; others unaffected |
| `revoked` (access withdrawn at Google) | person blocked until reconnect or an explicit disconnect (never auto-deleted) |
| Cache cleared by cleanup (> 24 h untouched) | next request asks Google; failure -> unconfirmed |

No answer from Google is never read as "free". Conflicts (existing ServiceOS appointments overlapping new Google
busy time) are listed for owner/admin and never acted upon.

## 8. Cache and errors
Window now-1 day .. now+183 days (booking horizon 180 + edges), chunks <= 60 days, <= 10 calendars, 6 s timeout,
one refresh per connection (DB claim 30 s), 60 s back-off after a failure (browse). Error codes: `revoked`,
`unavailable`, `rate_limited`, `calendar_not_found`, `invalid_response`, `not_configured`. Undecryptable token (key
changed) -> `not_configured`, row kept. Migration 0025 missing -> "no connections".

## 9. Isolation between businesses
Every store call is scoped by `workspace_id`; the same-workspace trigger refuses foreign staff ids; a business only
sees its own connections; the manage page lists only connections whose subject hash equals the verified account;
connection ids of other accounts answer "not found". Tested with several businesses, the same staff names and the
same Google account in two businesses.

## 10. Setup (Google Cloud + Vercel)
See [GOOGLE_CALENDAR_SETUP_RU.md](GOOGLE_CALENDAR_SETUP_RU.md) and [PRODUCTION_DEPLOYMENT_CHECKLIST.md](PRODUCTION_DEPLOYMENT_CHECKLIST.md).
Redirect URI (both flows): `<NEXT_PUBLIC_APP_URL>/api/integrations/google-calendar/callback`.

ENV (server-only, names only): `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`,
`EXTERNAL_CALENDAR_ENCRYPTION_KEY` (32 bytes base64; changing it disconnects everyone and changes all subject
hashes), `CRON_SECRET` (daily cleanup), plus the existing `NEXT_PUBLIC_APP_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## 11. Tests
`src/server/externalCalendar/__tests__/` — engine/domain, crypto, Google adapter (signed ID tokens, 11 rejection
cases, tampering, JWKS), PGlite integration (salon example, refresh, fail-closed, cache, privacy, OAuth CSRF/replay,
manage page, two businesses one account, reconnect, revoke, isolation, cleanup, deactivation), cron auth, wiring
static test; `src/server/db/__tests__/migration0025.test.ts`, `migration0026.test.ts`.

## 12. Limitations of this version
- Not verified with real Google; Google "Testing" mode tokens expire after 7 days; production needs OAuth verification.
- Calendar UI suggestions (browser-side) do not know Google busy time; the server refuses with a generic conflict.
- No Google push notifications (webhooks); freshness from the 5 min / 60 s policy.
- `openid`-only manage sign-in to be confirmed with real Google (see §4).
- Vercel functions currently appear to run in `iad1` (USA): DSGVO question (docs/LEGAL_TODO.md).

## 13. Future: two-way sync (plan only, NOT implemented)
Writing ServiceOS appointments into Google (Direction 2 of PRODUCT_ARCHITECTURE.md §4.3) would need: a write scope
(`calendar.events` or app-created calendars `calendar.app.created`), a mapping table appointment <-> event id, update/
delete propagation, conflict rules (ServiceOS stays the source of truth), Google push channels for change
notifications, new Datenschutz text and a new Google verification. Separate stage; requires owner approval.
