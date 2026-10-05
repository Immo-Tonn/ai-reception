# ServiceOS: Team Staging (controlled test environment)

Status: PREPARED, NOT DEPLOYED. Deploying needs explicit owner permission. Staging is not production.

## 1. Environment model

| | LOCAL | STAGING | PRODUCTION |
|---|---|---|---|
| Purpose | development | team testing | real customers (NOT launched) |
| `NEXT_PUBLIC_APP_ENV` | unset / `local` | `staging` | `production` |
| Host | localhost / LAN | one Vercel project/domain | own domain (later) |
| Supabase | ServiceOS Dev | ServiceOS Dev (TEMPORARY team test environment) | its OWN new Supabase project (to be created later) |
| Data | any test data | TEST DATA ONLY | real |
| Badge + noindex | no | yes | no |

Rules:
- Staging temporarily reuses the existing **ServiceOS Dev** Supabase project. Only test data. No real customers, no real businesses.
- Do NOT create a new Supabase project for staging now. Production must later get its own project (`docs/BOOTSTRAP_NEW_SUPABASE.md`).
- The old `ai-reception` project is forbidden: never point any env var at it.
- Production is not launched. Production blockers stay in `docs/ROADMAP.md`.

What `NEXT_PUBLIC_APP_ENV=staging` does (and nothing else):
- A small fixed badge at the very top ("TEST ENVIRONMENT - test data only", DE/EN/UK/RU), pointer-events off, safe-area aware, on every page (public booking, client, auth, business shell, legal) because it is mounted in the root layout.
- `robots: noindex, nofollow` metadata and an `X-Robots-Tag: noindex, nofollow` header on every response.
- It is a marker, not security. Real protection = Vercel deployment protection (section 4).

`NEXT_PUBLIC_*` values are inlined at BUILD time: after changing one in Vercel you must redeploy.

## 2. Environment variables (NAMES only, never put values in git, chat or docs)

### Public (inlined into the browser bundle, must not be secret)
| Name | Required | Purpose | Read in |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes (without it the app runs in demo-only mode) | Supabase project URL | `src/lib/supabase/config.ts`, `src/proxy.ts` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes (same) | Supabase anon/publishable key (RLS protects data) | `src/lib/supabase/config.ts` |
| `NEXT_PUBLIC_APP_URL` | strongly recommended | Public origin for booking links, embed snippet, QR, `metadataBase` | `src/lib/config/publicBaseUrl.ts` |
| `NEXT_PUBLIC_APP_ENV` | yes for staging (`staging`) | Staging badge + noindex | `src/lib/config/appEnv.ts`, `next.config.ts`, `src/app/layout.tsx` |

### Server-only secrets (Vercel "Sensitive", never `NEXT_PUBLIC_`)
| Name | Required | Purpose | Read in |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | yes for guest booking, sign-up provisioning, rate limiting, My bookings | bypasses RLS; also derives the rate-limit HMAC secret | ONLY `src/lib/supabase/admin.ts` (static test enforces it) |

### Optional / automatic
| Name | Purpose |
|---|---|
| `ALLOWED_DEV_ORIGINS` | LOCAL dev only: comma list of LAN hosts for `next dev` (phone on Wi-Fi). Empty by default. Ignored in production builds. Do not set on Vercel. |
| `VERCEL_URL`, `VERCEL_ENV`, `VERCEL_PROJECT_PRODUCTION_URL` | Set by Vercel automatically. Used only as fallbacks by `publicBaseUrl.ts`. Do not set manually. |
| `TZ`, `LEGAL_RELEASE_CHECK` | tests only (`npm run check:legal`), not for deployments |

### Public base URL behaviour (`getPublicBaseUrl`)
1. `NEXT_PUBLIC_APP_URL` (origin only; path/slash stripped) wins everywhere. Set it for staging to the staging domain.
2. Unset on a Vercel PREVIEW deployment (`VERCEL_ENV=preview`): `VERCEL_URL` (the per-deploy URL) is used, never the production domain.
3. Unset on a production-environment deployment: `VERCEL_PROJECT_PRODUCTION_URL`, then `VERCEL_URL`.
4. Local request host (localhost / 127.0.0.1 / [::1]) in dev; otherwise `null` = UI says "not configured". A non-local `Host` header is never trusted (host-header spoofing).
Consequence: per-deploy preview URLs change every push, so booking links/QRs created on one preview differ from the next. For stable links use one fixed staging domain + `NEXT_PUBLIC_APP_URL`.
`metadataBase` in the root layout is derived from the same value (omitted when unknown), so canonical/OG URLs are absolute.

### Hard-coded hosts audit (src, public, next.config, scripts)
- `next.config.ts`: LAN IP removed, now `ALLOWED_DEV_ORIGINS`.
- `publicBaseUrl.ts`: `localhost`/`127.0.0.1` only as local-dev detection/fallback (justified).
- `public/sw.js`: localhost/private-range check only to disable caching on dev hosts (justified).
- `PublicFooterView.tsx`: operator website link (content, not config).
- `embed-demo/page.tsx`: placeholder `your-serviceos-domain.com` in a documentation snippet.
- `supabase/config.toml`: `127.0.0.1:3000` is the LOCAL Supabase CLI config, not used by hosted projects.
- No Supabase project ref/URL is committed (static test enforces).

## 3. Vercel project checklist (owner does this; nothing here was done)
- [ ] Framework preset: Next.js. Root directory: repo root. Build command `next build` (default), install `npm ci`, no custom output dir.
- [ ] Node.js version: 20.x (`engines` in package.json, `.nvmrc`). Note: supabase-js prints a deprecation notice for Node 20; moving to 22.x later is advised (change `engines` + `.nvmrc` together, rerun tests).
- [ ] Env vars per environment: Production-environment deployment of the STAGING project gets `NEXT_PUBLIC_APP_ENV=staging`, `NEXT_PUBLIC_APP_URL=<staging domain>`, the two Supabase public vars and the service-role key (Sensitive). Preview environment: same, optionally without `NEXT_PUBLIC_APP_URL`.
- [ ] Use a dedicated Vercel project for staging (so the future production project stays clean). Staging branch: `chore/team-staging-readiness` (or a merged `staging` branch); Production branch of this project = the staging branch.
- [ ] Deployment Protection: enable Vercel Authentication or Password Protection for ALL deployments. Guest booking needs public access; if testers must test without Vercel accounts, use Password Protection and share the password out of band. Protected previews also block crawlers; noindex stays as a second layer.
- [ ] Domain: one fixed staging domain (e.g. a subdomain); HTTPS is automatic.
- [ ] After the first deploy, set `NEXT_PUBLIC_APP_URL` to the real staging URL and redeploy (inlined at build).
- [ ] Verify clean build: a `git archive`-style copy with NO env values builds successfully (verified, see below).

Build facts verified: `npm run build` passes from a clean copy of the git-tracked files without any env vars (Supabase-less build is fine: pages are dynamic and read env at runtime). Nothing in the build depends on `.env*`, `.graphify` or `supabase/.temp`. Client chunks (`.next/static`) contain none of the server-only names, no `sb_secret_`, no `service_role`, no JWT-like strings.

## 4. Supabase dashboard items (OWNER, manual; none changed by engineering)
ServiceOS Dev project, Authentication:
- [ ] URL Configuration: Site URL = staging domain; Redirect URLs include the staging domain (`https://<staging>/**`). Keep localhost entries for local work. Preview URLs need a wildcard entry if previews are used.
- [ ] Confirm email: decide and note the state. If ON, sign-up shows the neutral "check your e-mail" state and the confirmation link uses Site URL; there is NO `/auth/callback` route yet (production blocker), so testers should rely on OFF for staging unless the callback is built.
- [ ] Rate limits (auth emails/sign-ins): review defaults so a team of testers is not locked out; built-in e-mail sender is heavily limited (custom SMTP is a production blocker).
- [ ] Leaked-password protection is a production item (needs a paid plan feature); note state only.
- [ ] Do not enable additional providers, do not change RLS, do not run migrations from staging.

## Mandatory real-device touch check

Why: on 2026-10-05 a phone loaded the LAN dev URL (`http://192.168.x.x:3000`), the page rendered and scrolled, but NOTHING reacted to taps. Cause (reproduced, A/B tested): `next dev` (Next 16) blocks `/_next/*` dev requests (HMR websocket etc.) from any host that is not `localhost` or listed in `allowedDevOrigins`; the server-rendered HTML then never hydrates. `ALLOWED_DEV_ORIGINS` is empty by default (the LAN IP was deliberately removed from `next.config.ts`), so a LAN dev server is inert on a phone unless `ALLOWED_DEV_ORIGINS=<your LAN IP>` is set in `.env.local` and the dev server restarted. This can never happen on Vercel (production build, no dev resources).

Rules:
- Team demos and any "does it work on a phone" check use the **Vercel staging URL, NOT the LAN dev server**.
- LAN dev is for developers only: set `ALLOWED_DEV_ORIGINS=192.168.x.y` in `.env.local`, restart `next dev`, hard reload the phone. If it is missing the dev console prints a warning at start and a red banner "DEV: ... will NOT respond to taps" is shown at the bottom of every page (server-rendered, dev only).
- A phone that was used on an older deploy/dev session: Safari > Settings > Advanced > Website Data (or a private tab) before testing.

Checklist (iPhone Safari, then Add to Home Screen once; staging URL; clean tab). Each step must visibly react to the FIRST tap:
1. `/book/<slug>`: pick a service, a date, a time, fill the form, submit. Expected: each step advances; confirmation shows.
2. Header: open language menu, change language; open theme switcher, change theme. Expected: instant change, menu closes.
3. `/client/bookings` (signed in): open Reschedule panel, close it, open Cancel panel, close it (do NOT confirm on real data). Expected: panels open/close.
4. Business app (`/<workspace>/calendar`): tap `+` (quick create), close the sheet; open an appointment sheet, close it; tap bottom navigation items and "More". Expected: sheets close and the page below is immediately tappable again.
5. Navigate back/forward and rapidly between 3 pages, then repeat one tap from steps 1-4. Expected: still reacts.
6. Rotate to landscape and back, then tap once more.

Evidence to capture (attach to the test report): screenshot of the failing screen; Safari Web Inspector (Mac > Safari > Develop > <iPhone> > the page) Console errors and Network tab (any `/_next/*` 403/404, any failed JS chunk); `document.querySelector('button')` keys starting with `__react` (empty = not hydrated); then a hard reload (long-press reload > Reload Without Content Blockers, or clear Website Data) and whether it recovers. Also note URL host, build/commit, time.
Failing = any tap that needs more than one try or does nothing. A not-hydrated page (no `__react` keys, 403s on `/_next/`) means wrong environment, not a feature bug: first re-test on the staging URL.

## 5. How a tester works
Create a separate test business:
1. Open the staging URL (enter the protection password if asked). Check the orange "TEST ENVIRONMENT" badge is visible.
2. `/signup` with a tester e-mail (use an address like `name+test1@...`; never a customer's) and a throwaway password.
3. Complete onboarding (name it clearly, e.g. "TEST <your name> Salon"; add services, hours).
4. Public booking URL: `/book/<slug>` (shown in Settings > Online booking, with QR/embed).
5. Optional: Settings > make the business discoverable (public listing switch) so it appears in `/client/book`.
Create a client account and book:
6. Another browser/private window: `/client/signup` (separate e-mail), then `/client/book` (or `/book/<slug>` directly), pick service/date/time, confirm.
7. Check My bookings (`/client/bookings`): cancel/reschedule. In the business app: the appointment appears in Calendar/Today.

Allowed data: invented names, test e-mails you own, fake phone numbers, fake amounts.
Forbidden: real customers, real company data, real payment/IBAN data, health data, anyone else's personal data, credentials of other services, anything you would not want in a shared test database. Data is shared among all testers and may be wiped at any time.

### Bug report template
```
URL:
Device / OS / browser:
Language / theme (Light/Dark/System):
Workspace slug:
Date and time (with timezone):
Steps:
1.
Expected:
Actual:
Screenshot / screen recording:
Logged in as (business / client / guest):
```

## 5a. TEAM TESTING SCENARIO (who does what, who sees what)
Use three testers (A, B, C) and two or three people playing clients. Test data only.

**Businesses (each in their own browser / private window)**
1. Developer A signs up at `/signup`, creates **Business A** (e.g. "TEST A Salon"), adds a service and hours.
2. Developer B creates **Business B**, Developer C creates **Business C** the same way.
3. In Settings > Business profile > "Online booking and visibility": A and B switch **"List in the ServiceOS directory"** ON. C leaves it **OFF** on purpose (to test the direct link only). All three keep "Accept online bookings" ON.

**Clients**
4. **Client 1** (new window): `/client` > **Book** > `/client/book`. Expected: the list shows Business A and Business B, NOT Business C, and no demo businesses. Pick B > `/book/<slug of B>` > choose service, time, details > book. The confirmation shows B's name; the specialist line shows a real staff name, or the business name (never "You").
5. **Client 2** (another window, not signed in) opens Business A's **direct link** `/book/<slug of A>` and books. Business C's direct link works too although C is not listed.
6. **One Client Account, two businesses**: Client 1 signs up/in at `/client/signup`, books at A and at B (same browser, or sign in after booking). **My bookings** (`/client/bookings`) shows both, each with business name, the business's local time and (if the phone's zone differs) the time zone note. Cancel and reschedule one. The **Book an appointment** button on My bookings leads back to `/client/book`.
7. Empty directory: while nobody is listed, `/client/book` explains that businesses appear after their owner turns on "List in the ServiceOS directory" and mentions the direct link.

**What each person must see**
| Who | Sees | Must NOT see |
|---|---|---|
| Business A owner | only Business A (calendar, clients, services, bookings made at A) | any data of B or C; B/C in the workspace switcher |
| Business B / C owner | likewise only their own business | A's bookings or clients |
| Client 1 (account) | own bookings at A and B in My bookings, business name + time | other people's bookings; internal fields (ids, notes, private appointments) |
| Client 2 (guest) | the booking confirmation; no list of other bookings | Client 1's bookings |
| Any client | business name, service, specialist name (or business name), time | the placeholder "You/Sie/Ви/Вы" as a specialist; owner, finance or CRM screens |

Check each in DE, EN, UK and RU, light and dark theme, on an iPhone (Safari) if possible.

## 6. Rollback and known limitations
- Rollback: Vercel dashboard > Deployments > promote a previous deployment (instant); env change = redeploy. Staging DB rollback: not available (shared Dev DB; migrations are additive, no down-migrations).
- No health endpoint, no error monitoring/alerting, no custom SMTP, no `/auth/callback`, no forgot/reset password, legal pages are drafts (Impressum/Datenschutz placeholders: `docs/LEGAL_TODO.md`). Supabase session cookies are set by `@supabase/ssr` (SameSite=Lax, path `/`, not marked Secure by the library; Vercel is https-only so this is acceptable for staging, review for production). The claim cookie `serviceos_claims` is httpOnly, SameSite=Lax and Secure when `NODE_ENV=production`.
- Proxy matcher already skips `/book`, embed, assets; session refresh only runs for requests carrying `sb-` cookies.
- Bookings made before migration 0018 do not appear in My bookings.
