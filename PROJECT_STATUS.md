# ServiceOS — Project Status

Audit date: 2026-09-22. Based on reading the actual code (not memory) and running `npm run build` / `npm run test`.

**Build:** ✅ `npm run build` succeeds — Next.js 16.3.5, Turbopack, all 21 routes generated, no errors.
**Tests:** ✅ `npm run test` — 9 test files, 51 tests, all passing.

## Status by block

| Block | Status |
|---|---|
| Today / Dashboard | ✅ DONE |
| Calendar | ✅ DONE |
| Appointments | ✅ DONE |
| Clients | ✅ DONE |
| Public Booking | ✅ DONE |
| Embed Booking | ✅ DONE |
| Staff | 🟡 PARTIAL |
| Resources | 🟡 PARTIAL |
| Waiting List | ✅ DONE |
| Inbox | ✅ DONE |
| Work / Leads / Quotes / Jobs / Projects | ✅ DONE |
| Finance / Invoices | 🟡 PARTIAL |
| Analytics | ✅ DONE |
| Permissions / Roles | ✅ DONE |
| Privacy / Visibility | ✅ DONE |
| Financial buckets | ✅ DONE |
| Multi-language DE/EN/UK/RU | ✅ DONE |
| Light/Dark/System | ✅ DONE |
| PWA | ✅ DONE |
| Mobile navigation | ✅ DONE |
| Demo workspaces | ✅ DONE |
| Authentication | ⬜ NOT STARTED |
| Database / Supabase | ⬜ NOT STARTED |
| Storage | ⬜ NOT STARTED |
| Payments | ⬜ NOT STARTED |
| Notifications | ⬜ NOT STARTED |
| Offline mode / sync | 🟡 PARTIAL (by design) |
| AI assistant | ⬜ NOT STARTED (canned demo) |
| Native mobile app | ⬜ NOT STARTED |
| Tests | ✅ DONE (51/51 passing) |
| Deployment / Vercel readiness | ✅ DONE |

## Details

### Today / Dashboard — ✅ DONE
`TodayView.tsx` reads real data via `useAppointments`/`useClients`/`useInvoices`, computes today's schedule, revenue, outstanding, and now-functional attention items (fixed this session).

### Calendar — ✅ DONE
`CalendarView.tsx` wires create/update/remove through repositories; Day/Week/Month/Staff views, Quick Actions, Move/Reschedule, audit log, waiting-list matching on cancel.

### Appointments — ✅ DONE
Real conflict detection (`conflicts.ts`, interval overlap incl. buffers), shared availability engine (`availability.ts`, reused by Calendar and Public Booking), recurrence expansion (`recurrence.ts`). All three unit-tested.

### Clients — ✅ DONE
Full CRUD via `Repository<T>`, search, cross-linked with live appointment history (fixed earlier this session — Client Detail no longer reads static demo data).

### Public Booking — ✅ DONE
`BookingWizard.tsx` → server actions → `computeAvailableSlots` → `createPublicBooking`, which re-validates slot freshness and forces normal visibility / main bucket / pending status.

### Embed Booking — ✅ DONE
`public/embed.js` is a real vanilla-JS widget loader (button + iframe modal); embed route reuses the same `BookingWizard`/server actions.

### Staff — 🟡 PARTIAL
**Have:** real types/demo data, used correctly in availability, conflict detection, and appointment forms across all 4 industry presets.
**Missing:** no admin screen to create/edit/remove staff — catalog is preset-config only.

### Resources — 🟡 PARTIAL
**Have:** same as Staff — real data, used in availability/conflict logic and resource picker in the appointment form.
**Missing:** no CRUD/admin UI.

### Waiting List — ✅ DONE
Real repository, `matchWaitingList()` filtering by service/date/staff/weekday/time, genuinely invoked when an appointment is cancelled (both client- and server-side).

### Inbox — ✅ DONE
Repository-backed conversations, read/status/reply/client-linking all functional (AI draft reply is explicitly a canned demo action).

### Work / Leads / Quotes / Jobs / Projects — ✅ DONE
Four repositories, real stage-advance and Lead → Quote → Job → Invoice conversion; Visibility and Financial Bucket set independently on each.

### Finance / Invoices — 🟡 PARTIAL
**Have:** real CRUD, real revenue/outstanding calculations from live invoice data.
**Missing:** `Invoice` has only `bucket: FinancialBucket`, no `visibility` field at all — an asymmetric gap versus Appointments/Work (not a conflation bug — just missing, so an invoice can't independently be marked private the way an appointment can).

### Analytics — ✅ DONE
`computeAnalytics()` is a pure function over real appointment/invoice/lead arrays — no hardcoded numbers.

### Permissions / Roles — ✅ DONE
Default-deny role→permission matrix, `assertCan()` enforced server-side, unit-tested.

### Privacy / Visibility — ✅ DONE
`masking.ts` does structural redaction (fields omitted, not blanked); tests assert sensitive data never appears in a masked payload.

### Financial buckets — ✅ DONE
Confirmed independent from Visibility everywhere checked — separate types, separate permission strings, `masking.ts` never reads `financialBucket`. The only related gap is Finance's missing `visibility` field (see above) — an omission, not a merge.

### Multi-language DE/EN/UK/RU — ✅ DONE
All 4 locale files present and structurally identical (same ~500 keys each), locale metadata (dir/bcp47), cookie-based resolution.

### Light/Dark/System — ✅ DONE
Cookie-persisted theme, `data-theme` attribute driving `tokens.css`, server-read for no-flash initial render.

### PWA — ✅ DONE
Valid manifest, correctly-sized icons, service worker does genuine (deliberately limited — static assets only) caching.

### Mobile navigation — ✅ DONE
Real `BottomNav` with active-route detection, CSS-only responsive gating (no JS breakpoint/hydration risk).

### Demo workspaces — ✅ DONE
4 distinct industry presets (salon/werkstatt/cleaning/consulting) with real seed data and a working `WorkspaceSwitcher`.

### Authentication — ⬜ NOT STARTED
`session.ts` is a hardcoded demo identity gated only by a role cookie. `LoginForm.tsx`/`SignupForm.tsx` have literal `// TODO: wire up to Supabase Auth` and do nothing on submit beyond a redirect.

### Database / Supabase — ⬜ NOT STARTED
6 SQL migration files exist (with a README noting they're unapplied). Zero `@supabase/*` dependencies, zero Supabase client imports anywhere in `src/`.

### Storage — ⬜ NOT STARTED
No upload/file-storage code anywhere; branding/logo upload is explicitly a placeholder.

### Payments — ⬜ NOT STARTED
No Stripe or payment-provider code anywhere.

### Notifications — ⬜ NOT STARTED
No push/email/SMS code anywhere.

### Offline mode / sync — 🟡 PARTIAL (by design)
Service worker caches static assets + an offline fallback page only; navigations and data fetches are always network-only. No background sync/IndexedDB queue — this is the documented, deliberate scope ("installability, not offline-first").

### AI assistant — ⬜ NOT STARTED (canned demo)
`AssistantView.tsx` picks between hardcoded responses via a regex match on the input text. No LLM SDK, no network call.

### Native mobile app — ⬜ NOT STARTED
No React Native/Expo code anywhere in the repo.

### Tests — ✅ DONE
51/51 passing across 9 files: conflicts, recurrence, availability, finance calculations, waiting-list matching, permissions/roles, masking, localIsoDate, analytics.

### Deployment / Vercel readiness — ✅ DONE
`next.config.ts` is default/empty. Zero `process.env` usage in `src/` — no required env vars. All persistence is client-side `localStorage` or an in-memory server mock (fine for a demo, resets per serverless invocation as expected). Build succeeds cleanly, no filesystem writes, no long-running processes.

## What blocks what

**Blocks a Vercel demo right now:** Nothing found. The app builds cleanly, needs no environment variables, and has no dependency on a persistent filesystem.

**Blocks a real multi-device test:** Yes, confirmed — all client data lives only in that browser's `localStorage` (`createLocalRepository.ts` is the sole persistence path; the Supabase migrations exist but are unwired). Two devices/browsers will each see independent, non-synced demo data. This is expected given the project's current "local/demo persistence" design, not a bug.

**Safe to leave unfinished after a first demo version:** Staff/Resources admin CRUD screens (data already flows correctly without them), the missing Invoice `visibility` field, offline sync beyond asset caching (deliberate), native mobile app, and all of Auth/Supabase/Payments/Notifications/real AI — all explicitly out of scope for the current local-demo phase per prior direction in this project.

## Top 5 next steps

*(Not started now — for planning only.)*

1. Connect Supabase (DB + Auth) behind the existing `Repository<T>` / `getSession()` interfaces — the adapter seam is already in place; this is the single change that unblocks real multi-device/multi-user use.
2. Decide and wire a real AI provider behind an `AIService`/`AIProvider` interface for the Assistant (currently a canned regex demo).
3. Add the missing `visibility` field to `Invoice` for parity with Appointments/Work.
4. Build minimal Staff/Resources admin screens (CRUD) — the underlying data model already supports it.
5. Decide on a payment provider and wire it behind a `PaymentService`/`PaymentProvider` interface once invoicing needs to collect real payment.
