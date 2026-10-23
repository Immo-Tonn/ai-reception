# Production Deployment Checklist

Last updated: 2026-10-13. Branch: `feature/google-calendar-freebusy` (local commits only — **nothing pushed, no PR,
no deploy**). Production = Vercel project on the team repo `Immo-Tonn/ai-reception` + Supabase project
**ServiceOS Dev** (the only database; it serves production).

## Team Lead Handover Summary
Full Russian step-by-step handover (Google Cloud, Vercel, Supabase, costs, tests, instructions for the team lead's Claude): [TEAM_LEAD_HANDOVER_GOOGLE_CALENDAR_RU.md](TEAM_LEAD_HANDOVER_GOOGLE_CALENDAR_RU.md).

**Done (local, tested):**
- Google Calendar FreeBusy integration (one direction, per staff member, own Google account): engine integration,
  OAuth + PKCE + OIDC ID-token verification, encrypted tokens, fail-closed policy, settings UI, connect / setup /
  manage pages (DE/EN/UK/RU), shared-grant-safe revocation, daily retention cleanup (Vercel Cron), staff
  deactivation hook. Mock-provider and PGlite tests: 1124 passing.
- Mobile word-break / horizontal-scroll fixes across the app (all locales).
- Datenschutz draft section for the integration (4 languages), clearly marked **Needs legal review**.
- Migration 0025 applied to production after a full local backup; existing data verified unchanged.

**Needed from the team lead:** confirm the production domain; Google Cloud project + OAuth client + consent screen;
Vercel ENV (`GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `EXTERNAL_CALENDAR_ENCRYPTION_KEY`,
`CRON_SECRET`, `NEXT_PUBLIC_APP_URL`); decision on Supabase backups (plan) and on the
Vercel function region; legal review; review and merge of the branch.

**Risks:** no automatic database backups on the current Supabase plan (and Free projects pause after 1 week of
inactivity); integration not yet tested with real Google; Vercel functions appear to run in the US (`iad1`);
Datenschutz/Impressum not legally approved; Google "Testing" tokens expire after 7 days.

**Open decisions:** final domain and product name; retention periods (legal); Supabase plan/PITR; function region
`fra1`; whether to enable the integration for real users before Google verification.

## 1. Already done
- [x] Code: integration + cleanup + manage page + word-break fixes, local commits (see `git log` on the branch)
- [x] Migration **0025** applied to production (2026-10-13), backup taken before, row counts and content verified
- [x] Migration **0026** applied to production (2026-10-13): fresh encrypted backup, isolated restore test incl. Supabase Auth (12/12 users), 0026 tested on the restored copy, then applied; column/index/constraint verified, content of all 33 `public` tables unchanged, production pages 200
- [x] Local encrypted backup (AES-256 disk image) — see [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md)
- [x] Docs: [EXTERNAL_CALENDAR.md](EXTERNAL_CALENDAR.md), [DATA_RETENTION.md](DATA_RETENTION.md),
      [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md), [GOOGLE_CALENDAR_SETUP_RU.md](GOOGLE_CALENDAR_SETUP_RU.md), [LEGAL_TODO.md](LEGAL_TODO.md)

## 2. Not done yet
- [ ] Push / PR / review / merge to `main` (needs owner approval)
- [ ] Google Cloud setup and first real end-to-end test
- [ ] Vercel ENV variables and redeploy
- [ ] Legal review of Datenschutz (Google section) and Impressum
- [ ] Supabase backup plan decision

## 3. Migrations
| Migration | Production | Notes |
|---|---|---|
| 0001-0024 | applied (before 2026-10-13) | |
| 0025 external calendars | **applied 2026-10-13** | 2 tables, 4 functions, service role only |
| 0026 subject hash | **applied 2026-10-13** | 1 nullable column + format check + partial index |

All migrations of this branch are applied; `supabase db push --dry-run` reports "up to date". (The code would also
tolerate a database without 0026 for reads, see `store.ts`.)

## 4. ENV (names only; values in Vercel -> Settings -> Environment Variables, mark Sensitive)
| Name | Scope |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Production: the confirmed domain (origin only) |
| `GOOGLE_CALENDAR_CLIENT_ID` | server |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | server, Sensitive |
| `EXTERNAL_CALENDAR_ENCRYPTION_KEY` | server, Sensitive, 32 random bytes base64, **never rotate casually** (disconnects everyone) |
| `CRON_SECRET` | server, Sensitive, >= 16 random chars; without it the cleanup endpoint stays closed |
| `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | existing |

## 5. Google Cloud (production)
1. Project under a ServiceOS work account (2 owners, 2FA). Enable **Google Calendar API**.
2. Google Auth Platform -> Branding: app name, support e-mail, homepage, privacy policy URL
   (`<domain>/datenschutz`), terms if any; Authorized domains: the production domain.
3. Audience: External; Testing (test users) until verification; then Publish.
4. Data access: `openid`, `.../auth/calendar.freebusy`, `.../auth/calendar.calendarlist.readonly` — nothing else.
5. Clients -> Web application -> Authorized redirect URI: `<domain>/api/integrations/google-calendar/callback`
   (one URI for connect and manage). Separate client for local dev (`http://localhost:3000/...`) recommended.
6. OAuth verification (Calendar scopes are sensitive): verified domain (Search Console), approved privacy policy with
   the Limited Use statement, scope justification, demo video. No CASA (only for restricted scopes).

## 6. Domain check
- [ ] Team lead confirms in Vercel -> Domains which domain is primary (currently assumed: `https://ai-reception-two.vercel.app`)
- [ ] `NEXT_PUBLIC_APP_URL` equals it; Supabase Auth Site URL / Redirect URLs match it

## 7. Legal checks (Needs legal review)
Datenschutz Google section + whole Datenschutzerklärung + Impressum; `npm run check:legal` must pass before a public
launch. Questions: [LEGAL_TODO.md](LEGAL_TODO.md). Vercel function region (`iad1`) vs `fra1`.

## 8. Tests before deploy
- [ ] `npx tsc --noEmit`, `npx eslint`, `npx vitest run`, `npm run build` green on the merge commit
- [ ] Preview/staging with a fixed domain: connect a test Google account, busy 14:00-15:00 -> slot hidden for that
      person only; cancel event -> free again <= 5 min; manage page: sign in, disconnect; revoke in Google account ->
      "access withdrawn"; two businesses with one Google account; cron endpoint with and without secret (401)
- [ ] Regression: public booking, client account reschedule/cancel, business calendar create/move, multi-workspace switcher
- [ ] Mobile (iPhone) at 320-414 px in DE/EN/UK/RU: no horizontal scroll, no mid-word breaks

## 9. Rollback plan
- **Code:** redeploy the previous production deployment in Vercel (Deployments -> Promote) — no data change needed.
- **Integration only:** remove `GOOGLE_CALENDAR_CLIENT_ID/SECRET` -> integration becomes "not configured";
  connected people become unconfirmed (blocked) until disconnected — disconnect them or keep the env.
- **Cron:** remove the `crons` entry or `CRON_SECRET` (endpoint closes).
- **Migration 0026:** `alter table public.external_calendar_connections drop column google_subject_hash;` (only with
  approval; the old code ignores it, so dropping is not required for a code rollback).
- **Migration 0025:** rollback script stored next to the local backup (`rollback_0025.sql`); drops only its objects.
- **Database disaster:** restore procedure in [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md).

## 10. TODO: Custom Domain & Rebranding Before Public Launch
`ai-reception-two.vercel.app` is a working domain, **not** the final product domain or name. When the final domain
and brand are chosen (team lead confirms in Vercel), check and update:
- [ ] Vercel -> Domains (primary domain, redirects from the old one) and `NEXT_PUBLIC_APP_URL`
- [ ] Google OAuth -> Authorized redirect URIs (`<new>/api/integrations/google-calendar/callback`)
- [ ] Google Auth Platform -> Branding (name, logo, homepage, privacy/terms links), Authorized domains, domain verification
- [ ] Google Search Console verification of the new domain (needed for OAuth verification)
- [ ] Supabase Auth -> Site URL, Redirect URLs, e-mail templates (links in sign-up / reset mails)
- [ ] Datenschutz and Impressum links (footer, Google consent screen, connect pages)
- [ ] Staff connect links and the manage page URL (old links stop working after the switch if the old domain is removed)
- [ ] Links in e-mails, notifications, embeds (`embed.js` snippets on customer websites), QR codes already printed
- [ ] Canonical URLs, `metadataBase`, Open Graph, any future sitemap/robots — all derive from `NEXT_PUBLIC_APP_URL`
- [ ] Cookie domains and callback URLs (all host-only today; re-test after the switch)
- [ ] Product name in UI strings (`common.appName`, locale files), PWA manifest, page titles
- [ ] Re-test OAuth (connect + manage) on the new domain

Code already centralises the base URL: every absolute URL comes from `getPublicBaseUrl()`
(`src/lib/config/publicBaseUrl.ts`: `NEXT_PUBLIC_APP_URL` -> Vercel URLs -> local host). No production domain is
hard-coded in `src/`. Do **not** mass-replace domains before the final decision.
