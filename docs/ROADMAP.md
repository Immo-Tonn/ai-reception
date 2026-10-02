# ServiceOS — Roadmap

What is built, what is only prepared, what is decided but not started,
and what is direction only. **Listing something here does not mean it
should be coded now.** Why things are shaped this way:
[`PRODUCT_ARCHITECTURE.md`](./PRODUCT_ARCHITECTURE.md). Current working
state: [`../HANDOFF_GRAPH.md`](../HANDOFF_GRAPH.md).

---

## Order of the next stages

| # | Stage | Status |
|---|---|---|
| 1 | **Product Architecture** (these documents) | NOW — being fixed |
| 2 | **Booking / Distribution Foundation** — starts with an **audit** of what already exists; code only for what the audit proves is missing | **NEXT** |
| 3 | **External Calendar Foundation** (provider-agnostic, no real Google) | AFTER THAT |
| 4 | **Real Google Calendar integration** (OAuth/API) — separate task, can go to a separate developer | LATER |

Stage 2 is **not** "build a booking engine". `/book/[workspaceSlug]`, the
embed widget and the shared availability engine already exist. The audit
checks whether they already support the target model: a business gets a
public booking URL → works with **no website of its own** → the URL can
be posted on Instagram / WhatsApp / Google Business Profile / email / SMS
/ a QR code → a business **with** a website uses a plain "Book" button/link
or the existing embed widget → every channel runs the **same booking
flow** and the **same Availability Engine**. Only after the audit do we
decide which minimal foundation/code is actually missing.

Fixed principles for all stages: a business website is **not required**;
a Client App is **not required** to book; a Client Account is **not
required** for guest booking; the native Business App (FUTURE) uses the
same backend/API; Client App, city discovery and marketplace are FUTURE;
Google Calendar API/OAuth is **not** implemented now.

---

## NOW — exists in the repository (demo/local data)

- ServiceOS core web app (Next.js, PWA), DE/EN/UK/RU, light/dark
- Business modules: Today, Calendar, Appointments (incl. recurrence,
  conflicts, waiting list), Clients, Inbox, Work (Leads→Quotes→Jobs→
  Projects), Finance, Analytics, Settings
- Four demo industries on one engine: Salon, Werkstatt, Cleaning,
  Consulting (`WorkspaceConfig`)
- **Public Booking** `/book/[workspaceSlug]` with guest booking,
  automatic ClientRecord find-or-create per workspace, and the
  **embeddable widget** (`public/embed.js`, `/book/[workspaceSlug]/embed`)
- One shared availability engine (`computeAvailableSlots`) used by the
  Calendar and Public Booking
- Local demo Client Account + My Bookings (reschedule/cancel)
- Business signup/onboarding screens (UI; not backed by a real account store)
- Provider-agnostic layering (`Repository<T>`, auth abstraction)
- Native Expo shell in `apps/mobile/` (foundation only)
- Team workflow: feature branches → PR → `main` → Vercel

> In review at the time of writing: PR #2 (UI finish + Notifications
> foundation). Not part of `main` until merged.

## FOUNDATION ONLY — structure and interfaces, no real integration

- **Booking / Distribution layer** — already exists
  (`/book/[workspaceSlug]`, embed widget, shared availability engine).
  **NEXT: audit it** against the target model above; add only what the
  audit shows is missing. No new booking engine.
- **External Calendar architecture** — `ExternalCalendarService`,
  `CalendarProvider` interface, busy-interval model, a mock provider.
  *After the Booking/Distribution stage (External Calendar Foundation).*
  No Google OAuth, no Google API, no Outlook.
- **Availability integration point** — extra engine input for external
  busy intervals / time-off, so external busy time can later block slots
  without touching any booking channel.
- Notifications foundation (NotificationService → NotificationProvider →
  Console/Mock adapter) — see PR #2
- Native mobile shell (`apps/mobile/`)

## PLANNED — decided, not started

- **Supabase / shared backend completion.** Today only a draft exists on
  another branch (`Sa-Ev`); an architecture assessment recommends
  building the foundation from `main` with tenant-isolating RLS, atomic
  workspace provisioning and migrations as the single source of truth.
  Not started on `main`.
- Real authentication for business users; real Client Accounts
- **Real Google Calendar integration** (first `CalendarProvider`
  implementation, OAuth/API) — a separate task *after* External Calendar
  Foundation; can be handed to a separate developer
- Real notification providers (email, SMS, push) and a reminder scheduler
- Migrate Clients, Appointments, Waiting List, Finance, Audit from
  localStorage to the shared backend
- GDPR tooling: consent, export, deletion/anonymization, retention
- Staff roles/permissions enforced server-side

## FUTURE — direction only; must not be blocked, must not be built yet

- Native **Business App** (iOS/Android) on the same backend
- Separate **Client App** (My bookings across businesses, favorites,
  search, notifications)
- **City/category discovery** and marketplace (city search, nearby
  businesses, map, filters, public business profiles, reviews/ratings,
  featured businesses)
- Multi-city / multi-country expansion (Pforzheim → Karlsruhe →
  Stuttgart → Baden-Württemberg → Germany → other countries)
- Additional calendar providers (Microsoft Outlook / 365, others);
  two-way sync (ServiceOS appointment → external event)
- AI Assistant with a real provider
- Payments (Stripe/Mollie or similar)

---

## Explicit non-goals right now

No marketplace, no Client App, no native Business App, no Google/
Microsoft API code, no real OAuth, and no second booking or availability
engine. The Booking/Distribution stage begins with an audit, not code.
