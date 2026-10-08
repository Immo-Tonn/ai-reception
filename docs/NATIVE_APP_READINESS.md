# Native app readiness (Expo / React Native): read-only analysis

Question: can a future Expo/React Native app reuse the current backend? Short answer: the DATABASE and the pure TypeScript domain code are reusable; the APPLICATION LAYER is not callable from a native client today and needs a thin HTTP API layer. No code was changed for this analysis.

## Findings

1. No HTTP API exists. There is no `route.ts` anywhere in `src/app`. All business and client operations are Next.js Server Actions (`src/server/actions/*.actions.ts`, 20 files, `"use server"`). Server Actions are an internal RPC protocol bound to the Next build (action IDs, encrypted closures, cookie auth). They are not a stable, documented endpoint and cannot be called sensibly from a native client.
2. Logic location. The rules (availability engine, booking rules, scheduling, validation with zod, conflict checks, services/repositories) live in plain TypeScript under `src/server/services`, `src/server/booking`, `src/features/*`, `src/server/validation`. This is reusable server code: route handlers can call the same services. Do not reimplement it in the app.
3. Auth. Supabase Auth (email + password) with a session in `sb-*` cookies via `@supabase/ssr`. A native app would use `@supabase/supabase-js` with its own token storage and send the access-token JWT as `Authorization: Bearer`. Server code currently reads the session from cookies only (`src/lib/supabase/server.ts`), so route handlers must also accept a bearer token (`createClient` with the header, or `supabase.auth.getUser(jwt)`).
4. What RLS + the user JWT already allow natively (supabase-js directly, no server): row access on tenant tables for authenticated business users (RLS is the real tenant guard, policies are `to authenticated`). Plain CRUD could technically be done from the app, but this would bypass the server-side services (validation, availability re-check, audit, financial-bucket rules) and duplicate logic. Not recommended for anything beyond simple reads.
5. Service-role-only RPCs (anon/authenticated are revoked; the service key must NEVER be in a native app):
   - Guest/public booking: `get_public_booking_catalog`, `get_public_busy`, `create_public_booking`, `rate_limit_hit`.
   - Client account / My bookings: `issue_booking_claim`, `claim_booking`, `list_my_bookings`, `cancel_my_booking`, `reschedule_my_booking` (user id is taken from the server-verified session).
   - Provisioning: `provision_workspace` (sign-up/onboarding).
   These all require a server layer holding the service key, which is the right design; the native app needs an API in front of them.
6. Deep links. Public booking URLs are clean and stable: `/book/<slug>`, embed `/book/<slug>/embed`, client area `/client`, `/client/book`, `/client/bookings`. Universal Links / Android App Links are straightforward later, but nothing is prepared: no `apple-app-site-association`, no `assetlinks.json`, no custom scheme, `manifest.ts` is a web PWA manifest only. Slugs never change on rename (good for links). Base URL comes from one helper (`publicBaseUrl.ts`).
7. Session/claim model for guests uses an httpOnly cookie (`serviceos_claims`) that a native app would not share with a browser. A native client needs the claim token returned in the API response and stored in secure storage (or: account-first booking).
8. CORS/CSRF: nothing is configured for cross-origin API use (not needed for native, which ignores CORS, but needed if an Expo web build is ever used). Server Actions rely on same-origin; new route handlers must check auth explicitly and be rate limited (the PostgreSQL limiter exists).

## Blockers vs non-blockers

| Item | Blocker for native? |
|---|---|
| No HTTP API / only Server Actions | BLOCKER (build a thin layer) |
| Service-role RPCs not reachable by a client | BLOCKER, solved by the same layer (by design) |
| Cookie-only session reading on the server | BLOCKER until bearer-token support is added in the layer |
| Guest claim token only in httpOnly cookie | BLOCKER for guest flows, return it explicitly |
| API versioning / error contract / OpenAPI | needed with the layer, not a separate blocker |
| Deep-link files (AASA, assetlinks), push tokens | non-blocker now (later, with domain) |
| Database schema, RLS, SQL functions | NON-blocker (reusable as is) |
| Domain/service TypeScript, zod validation | NON-blocker (reused by the layer; can be shared as a package) |
| Supabase Auth password login | NON-blocker (supabase-js works in RN) |
| i18n dictionaries (DE/EN/UK/RU), time model (workspace TZ) | NON-blocker (plain TS data, shareable) |
| Production auth items (callback, reset, SMTP) | Needed for production anyway |

## Recommended path
1. Do NOT add logic to Server Actions only. Keep the rule "UI -> action -> service -> repository" (already in place) and add `src/app/api/v1/**/route.ts` handlers that call the SAME services with a bearer-token-aware Supabase client. Actions and routes become two thin adapters over one service layer.
2. Start with the client side (smaller surface): public catalog + availability, create booking, claim, My bookings (list/cancel/reschedule). Then business read endpoints (today, calendar, clients), then writes.
3. Auth: supabase-js in the app, JWT in `Authorization`; routes verify with `getUser`. No service key in the app, ever.
4. One contract: zod schemas already exist; export request/response types (or generate OpenAPI) into a shared package for the Expo app.
5. Rate limit and validate every route; return the same safe error shapes as actions (`result.ts`).
6. Later: Universal Links / App Links on the production domain, push notifications provider behind the existing adapter layer.
