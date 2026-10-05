# ServiceOS master roadmap

Source of truth for the ORDER of the big stages. Status words only (DONE / NEXT / LATER / PRODUCTION BLOCKERS / POST-V1);
no completion percentages. Details per stage live in the module docs (docs/STAFF_SCHEDULING.md, docs/BUSINESS_OPERATIONS.md,
docs/CLIENT_ACCOUNTS.md, docs/LEGAL_TODO.md) and the running log in HANDOFF_GRAPH.md.

Last updated: 2026-10-05, after the Business Operations foundation (commit `ddaa140`).

## DONE (foundation level, verified by automated tests; manual device E2E is done per stage by the owner)
- Multi-tenant Workspace, shared Supabase backend, RLS / tenant-isolation foundation (migrations 0001-0024, applied to ServiceOS Dev)
- Business Profile and public discoverability (public booking switch and directory listing are independent)
- Services (archive instead of delete, staff links, description)
- Clients / ClientRecord (edit, duplicate handling)
- Public Booking (guest, no account needed) and Calendar / Appointments
- Client Account, My Bookings, guest booking claim flow (per-appointment claim token), cancel / reschedule
- Staff, Resources, Working Hours (multi-interval, inherit/custom), Time Off and business closures, Booking Rules (auto-confirm, min notice, horizon, slot grid, deadlines)
- Unified availability engine (one engine; server-authoritative; DB exclusion constraints under concurrency)
- Timezone / business-day foundation (workspace timezone, never UTC or browser)
- Finance: invoices, line items, payments, atomic numbering, money in minor units, bucket + visibility RLS
- Work: Lead -> Quote -> Job / lightweight Project (idempotent conversions)
- Waiting List (manual; no auto-booking), Inbox foundation (trigger-produced events), Analytics foundation (SECURITY INVOKER RPC)
- Cross-module client relations (client detail "Related" panel)
- Privacy model (Visibility: normal/private/owner_only/custom) and financial bucket model (main/private/custom) as two independent axes
- DE / EN / UK / RU, Light / Dark / System
- Demo / real separation (demo-* routes only; real workspaces never fall back to demo/localStorage)
- Public footer and legal-page FOUNDATION (/impressum with TODO markers, /datenschutz placeholder; NOT production-ready text)

## NEXT: recommended order
1. **Production Auth + User Profile**: Confirm email, `/auth/callback`, expired/reused links, forgot / reset / change password, production SMTP, User Profile, audit of ALL password fields.
2. **Roles & Permissions / Staff Accounts**: owner / admin / manager / staff / accountant matrix, invitations, authenticated Business User != Staff Profile (future link via `staff_profiles.profile_id`), OWNER_ONLY / CUSTOM visibility UX, PRIVATE financial permissions.
3. **Notifications**: booking created / confirmed / cancelled / rescheduled, client and business e-mail, DE/EN/UK/RU templates, retry + idempotency, future push; Work/Finance Inbox events (`recordInboxEvent` exists).
4. **Google Calendar integration**: connection/auth, busy-time sync, staff calendars where appropriate, double-booking protection, sync-failure handling.
5. **Storage / Branding**: business logo (Supabase Storage + policies, proposal in docs/PROPOSED_MIGRATION_logo_storage.md), upload validation, later staff/service images.
6. **Workspace Management / Danger Zone**: archive/deactivate, protected deletion, typed business-name confirmation, history/dependency handling.
7. **Production Observability** (MUST NOT BE FORGOTTEN): Sentry/error monitoring, health endpoint, uptime monitoring, structured application/business failure events, critical alerts (Telegram or equivalent), no PII in alerts, server-side secrets only; monitor Public Booking, Supabase failures, appointment-creation failures, notification failures, external calendar sync failures.
8. **Security / Recovery / Production Hardening**: final RLS audit, second real workspace/owner tenant-isolation E2E, leaked-password protection, rotate development/exposed secrets before production, backups, recovery procedure, rate limits, abuse/error cases, privacy audit, production environment review.
9. **Final QA / Release Candidate**: iPhone/mobile, desktop, browsers, DE/EN/UK/RU, Light/Dark/System, PWA, timezone/DST, poor network/error states, permissions, privacy, finance separation, concurrency, demo/real isolation, accessibility/touch targets, full critical-path E2E.
10. **Production Release**: production domain, Vercel production configuration, production Supabase/Auth, SMTP, FINAL Impressum, FINAL approved Datenschutzerklaerung, monitoring enabled, backup/recovery verified, secrets rotated, final smoke tests.

## STAGING / TEST DEPLOY (milestone, not production)
After the completed Business Operations foundation and successful tsc, tests, build and critical smoke/manual E2E, ServiceOS may be prepared for a CONTROLLED Vercel staging deployment for our own testing (separate staging Supabase project or clearly separated data, no real customers, no production domain, monitoring optional). Staging != production. NOT deployed yet; needs explicit owner permission.

### STAGING / TEAM TESTING (prepared, NOT deployed)
Full guide: [docs/STAGING.md](STAGING.md). Staging uses the existing ServiceOS Dev Supabase as a TEMPORARY team test environment (test data only; production later gets its OWN Supabase project; old ai-reception forbidden).
- Done in code: `NEXT_PUBLIC_APP_ENV=staging` shows a top "TEST ENVIRONMENT" badge (DE/EN/UK/RU) and sends noindex (meta + X-Robots-Tag); committed LAN IP removed (`ALLOWED_DEV_ORIGINS`, dev only); `metadataBase` derived from the public base URL; previews prefer `VERCEL_URL` over the production domain; `engines` (Node 20.x) + `.nvmrc`; clean-copy build without env values passes; client bundle scan clean; static test blocks server-only env reads in client components.
- Owner manual: Vercel project + env vars + deployment protection + fixed domain; Supabase Auth Site URL / Redirect URLs / Confirm email / rate limits (see docs/STAGING.md).
- Native app readiness analysis: [docs/NATIVE_APP_READINESS.md](NATIVE_APP_READINESS.md).

## PRODUCTION BLOCKERS (must be closed before production; none blocks staging)
- Production Auth flows (stage 1) and leaked-password protection
- Impressum operator data NOT confirmed; Datenschutzerklaerung NOT production ready; `npm run check:legal` must pass (docs/LEGAL_TODO.md)
- Secrets: rotate development/exposed keys; service-role key server-side only
- Observability and alerting (stage 7); backups and recovery (stage 8)
- Second-owner tenant-isolation E2E, final RLS and privacy audit
- Real-Postgres concurrency verification for invoice numbering / conversions / booking races (PGlite is single-connection)

## KNOWN DEFERRED / TECH DEBT
Product / UX:
- Public Booking: some visually free days earlier showed no slots; re-verify after the unified availability engine
- Ukrainian My Bookings: "You" -> "Ви"
- Review broad `suppressHydrationWarning` usage; mobile navigation aria/accessibility audit
- Calendar / Inbox touch targets < 44 px where still present
- Staff deactivation warning for future appointments; audit texts may still be English-only
- `time_off.reason` is readable by any workspace member via direct query: permission review
- DST 02:00-02:59 transition edge case (non-existent local times offered if a business is open then)
- A business may book an appointment manually outside Working Hours: define the product policy
- Final password-field audit; logo Storage; Danger Zone
Business Operations:
- Work and Finance do not create Inbox events yet
- Inbox unread state is workspace-wide, not per user; unread navigation badge not connected
- Work Lead/Quote currency fixed to EUR
- Invoice update uses two calls (not atomic)
- Finance concurrency needs real Postgres verification
- Real server audit (database) vs the browser-local `useAuditLog` copy that Calendar/Finance/Work still write to for real workspaces (harmless but redundant; remove or route to the server audit)
- Assistant page (More) is still a demo placeholder
- Footer: duplicate copyright on /login and /signup was fixed in e5cb5af
Legal:
- Impressum operator data not confirmed. Do NOT assume the "Andreas Tonn / Labrity" client-site Impressum is the ServiceOS operator; do not invent legal data
- Datenschutz is NOT production ready
Small decisions pending: German `common.you` is informal ("Du") and is shown to clients as the owner staff label; Node 20 -> 22 move (engines + .nvmrc together); `Secure` flag on Supabase cookies before production.
Housekeeping: old ESLint errors in pre-existing files (react-hooks/*, next/no-html-link-for-pages); dev-only password helper script on the owner's Desktop (delete); `.env.local` still holds the old Supabase secret key (rotation postponed).

## POST-V1 (future, non-blocking unless architecture requires)
AI Assistant; payments provider / online payments; WhatsApp / Telegram integrations; advanced automation; automatic Waiting List matching/notifications; advanced resource capacity; recurring time off; advanced Analytics; React Native / native app; additional integrations.

## IF ANOTHER DEVELOPER OR AI CONTINUES THIS PROJECT
1. Read `HANDOFF_GRAPH.md`.
2. Read `docs/ROADMAP.md` (this file).
3. Read the architecture/module doc of the current stage (docs/BUSINESS_OPERATIONS.md, docs/STAFF_SCHEDULING.md, docs/CLIENT_ACCOUNTS.md, docs/LEGAL_TODO.md).
4. Inspect `git branch`, `git status`, `git log`.
5. Never assume uncommitted work is complete.
6. Never apply migrations before verifying the linked Supabase project (`supabase/.temp/project-ref` must match the ref in `.env.local`; always `supabase db push --dry-run` first).
7. ServiceOS Dev is the only allowed current development target.
8. Never use the old `ai-reception` Supabase project.
9. Never mix demo and real data.
10. Preserve the independent privacy (Visibility) and financial (bucket) dimensions; never collapse them into `is_private`.
11. Never commit / push / deploy without explicit owner permission.
12. Verify the latest `npx tsc --noEmit`, `npx vitest run` and `npm run build` before starting another major stage.

Safe rollback commits:
- `833fde7` - Client Accounts / Real Bookings baseline
- `25b6ffc` - Staff / Scheduling completed baseline
- `ddaa140` - Business Operations foundation completed (branch `feature/business-operations-foundation`)
