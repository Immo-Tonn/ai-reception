# ServiceOS — Team Start

A 5-minute orientation. For current state and what's in progress, see
[`HANDOFF_GRAPH.md`](../HANDOFF_GRAPH.md) — this file doesn't change
often, that one does.

## 1. What ServiceOS is

A multi-tenant SaaS platform connecting a service business with the
people who book its services.

**Business side:** Today, Calendar, Clients, Inbox, Work/Jobs/Projects,
Finance, Analytics.

**Client side:** Public Booking, Client Account, My Bookings,
Reschedule/Cancel.

**Demo workspaces:** Salon, Werkstatt, Cleaning, Consulting — one engine,
industry-specific labels/catalogs via `WorkspaceConfig`.

## 2. Core architecture rule

```
Web / Native UI
      ↓
Application / Services
      ↓
Own interfaces
      ↓
Provider adapters
      ↓
Current: Local/Demo   ·   Future: Supabase / other providers
```

UI never calls Supabase, Stripe, OpenAI, etc. directly. Always
`UI → Service → Interface → Adapter`. This is how the current Local/Demo
backend gets swapped for Supabase later without rewriting screens.

## 3. Current data

**Now:** Local/Demo repositories, browser `localStorage` — per-browser,
per-device. Two browsers/devices do not see each other's data.

**Later:** Supabase (PostgreSQL + Auth + Storage + realtime), shared
across devices.

Supabase is **not connected yet** — don't assume it is.

## 4. Supabase plan (future work, not started)

1. Create a Supabase project.
2. Use PostgreSQL inside Supabase.
3. Apply the existing migrations (`supabase/migrations/`).
4. Implement `SupabaseRepository` adapters behind the existing interfaces.
5. Implement a `SupabaseAuthProvider` (same pattern already used for
   client auth — swap the provider, not the interface).
6. Application interfaces stay the same; only the adapter changes.
7. Replace Local adapters via configuration.
8. Verify the multi-device flow: Client Booking → shared DB → Business
   Calendar, on two different devices.

UI does not get rewritten for this.

## 5. Privacy / finance model — do not collapse these

Two **independent** dimensions on every Appointment/Invoice:

- **Visibility:** `NORMAL` / `PRIVATE` / `OWNER_ONLY` / `CUSTOM`
- **Financial bucket:** `MAIN` / `PRIVATE` / `CUSTOM`

Never merge these into a single `is_private` flag. This is a
non-negotiable domain rule.

## 6. ClientRecord vs Client Account

- **ClientRecord** — a person's card inside one specific business
  (workspace). Isolated per workspace.
- **Client Account** — a person's own ServiceOS login, independent of
  any one business.

One person can have a Client Account plus a separate ClientRecord in
Salon and another in Werkstatt — those two records are never merged.
Guest booking works without a Client Account; a business-side
ClientRecord is still created/reused automatically.

## 7. Run the web app

```bash
npm install
npm run dev          # http://localhost:3000 (falls back to another port if taken)
npx tsc --noEmit      # typecheck
npm test              # vitest
npm run build         # production build
```

## 8. Mobile foundation

`apps/mobile/` — React Native + Expo (Expo Router), TypeScript.

```bash
cd apps/mobile
npm install
npm run start          # then i / a / w, or scan the QR with Expo Go
npm run typecheck
```

What's ready: navigation shell, Light/Dark/System theme, DE/EN/UK/RU
locale foundation, iOS/Android config (provisional identifiers — see
`apps/mobile/app.config.ts`), deep-link scheme (`serviceos://`), a
handful of placeholder screens (Welcome, Business, Client, Sign-in).

**Native app foundation ≠ a finished App Store app.** No Supabase, no
real auth, no push, no payments, no Calendar/Finance/CRM screens, no
signing certificates. See `apps/mobile/README.md` for the full list.

## 9. Environment variables

No real values live in the repo or in this doc. Names only, and only
ones actually referenced in code today or already planned:

- `EXPO_PUBLIC_API_BASE_URL` — mobile app's API base URL (read via
  `apps/mobile/src/lib/config.ts`); empty until a backend exists.

Supabase env var names (`SUPABASE_URL`, `SUPABASE_ANON_KEY` or similar)
are **not yet defined in code** — they'll be added when the Supabase
integration in §4 actually starts, not before.

## 10. Git / deployment

**Team repository:** https://github.com/Immo-Tonn/ai-reception
**Shared branch:** `main`

**Workflow (current, single-developer stage):**

```
local changes → typecheck/tests/build → commit → push directly to team/main → deployment
```

No PR required at this stage; revisit once more than one person is
pushing regularly. Never force-push to `main`.

Vercel: see the "Deployment Ready" section in `HANDOFF_GRAPH.md` for
current connection status.

## 11. Where to read next

- Current project state, in-progress work, known issues:
  → [`HANDOFF_GRAPH.md`](../HANDOFF_GRAPH.md)
- Architecture/product specification: → `ARCHITECTURE.md`,
  `PROJECT_STATUS.md` (repo root)
- Quick start: → this file

## 12. Current status

| Area | Status |
|---|---|
| Web/PWA | Working (demo/local data) |
| Business UI | Working (demo/local data) |
| Client Booking | Working (demo/local data) |
| Local repositories | Working (browser-only, not shared) |
| Supabase | NOT CONNECTED |
| Real Auth | NOT CONNECTED |
| Native app | FOUNDATION ONLY |
| AI | NOT CONNECTED |
| Payments | NOT CONNECTED |
