# Client accounts and "My bookings" (migration 0018)

## Entities (never merged)
| Entity | Where | Meaning |
|---|---|---|
| ClientRecord | `public.clients` (per workspace) | a business's CRM row about a customer |
| Client account | Supabase Auth user + `public.client_accounts` | the person's own login and tiny profile (name, phone, locale); global |
| Booking claim | `public.booking_claims` | per-APPOINTMENT proof that links an account to a booking |

## Why per appointment, not per ClientRecord
A guest booking matches an existing ClientRecord by e-mail. If claiming linked the whole ClientRecord,
anyone could book with a victim's e-mail, claim that booking and then see the victim's other bookings.
So access is per appointment, proven by a secret token that only the booking browser (or a client already
signed in at booking time) ever holds. A ClientRecord-level link is only safe with a VERIFIED e-mail
(Confirm email ON in production): backlog item, not built.

## Flow
1. Guest books at `/book/<slug>` (unchanged, no account). The server issues a claim token (hash stored).
2. Signed in at booking time: claimed immediately (`claim: "linked"`). Otherwise the token goes into an
   httpOnly cookie `serviceos_claims` (`claim: "pending"`); it never reaches browser JS or a URL.
3. The person signs up / in at `/client/...`; `/client/bookings` claims pending tokens, then lists bookings.
4. List, cancel and reschedule go through service-role-only functions that take the user id from the
   server-verified session. Only visibility = normal appointments, customer-safe fields only.
5. Reschedule uses the same availability engine as guest booking; the database exclusion constraints
   (0011) remain the final judge of overlaps. A moved booking returns to `pending` unless the business
   auto-confirms. Cancel / move are audited (`source = public`) and are instantly what the business sees.

## Security properties (tested in src/server/db/__tests__/migration0018.test.ts)
- anon/authenticated cannot read `booking_claims`; RPCs are service-role only; `client_accounts` is own-row only.
- Client A cannot list, cancel or move Client B's booking; a foreign/guessed/expired token claims nothing.
- Typed-e-mail attack: claiming your own booking never exposes the same ClientRecord's other bookings.
- Private appointments are never listed or manageable by the client.

## Not built (backlog)
Confirm email ON + `/auth/callback`, expired/reused links, forgot/reset password, custom SMTP, auth E2E,
leaked-password protection, ClientRecord-level link via verified e-mail, cancellation policy / minimum notice,
e-mail notifications, claim by e-mail link (manage link in a confirmation e-mail).
