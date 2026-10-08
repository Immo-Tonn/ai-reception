# ServiceOS — Product Architecture

The long-term shape of ServiceOS, written down so independent developers
don't build incompatible parts. This is a **direction document**: it says
where the system is going and which rules every change must respect. It
is not a to-do list — what to build and when lives in
[`ROADMAP.md`](./ROADMAP.md). Day-to-day orientation: [`TEAM_START.md`](./TEAM_START.md).
Current state: [`../HANDOFF_GRAPH.md`](../HANDOFF_GRAPH.md).

**Status tags used below**

| Tag | Meaning |
|---|---|
| **EXISTS** | Implemented in the repository today (possibly on demo/local data) |
| **FOUNDATION** | Interfaces/structure only, no real integration |
| **PLANNED** | Decided, not started |
| **FUTURE** | Direction only — must not be blocked by today's design, must not be built now |

---

## 1. What ServiceOS is

A universal SaaS platform for **service businesses**: salons, workshops,
cleaning, consulting, repair, training and other service companies. One
engine, many industries — an industry is configuration (labels, catalog,
which modules show), never a separate codebase.

Two sides share one backend and one set of data:

```
 BUSINESS SIDE                         CLIENT / BOOKING SIDE
 owner + staff run the business        people book services

 Web App (EXISTS)  ──────┐       ┌──── Public booking page  /book/[workspaceSlug]  (EXISTS)
 Native Business App     │       ├──── Website button / embedded widget            (EXISTS)
   (FUTURE)  ────────────┤       ├──── Client Account / My bookings                (demo only; real = PLANNED)
                         ▼       ▼
                 Application / service layer
                         ▼
                 Our own interfaces (Repository, Auth, Notification, Calendar, …)
                         ▼
                 Provider adapters
        today: Local/Demo   ·   target: Supabase and other providers
```

The native Business App is **not a separate system**: web and mobile use
the same backend/API and the same data. (A native foundation exists in
`apps/mobile/` — shell only.)

---

## 2. Business side

- **Workspace = one business.** Multi-tenant: every business-owned record
  carries a workspace; one workspace can have several **staff members**
  with roles/permissions.
- **Modules** (EXISTS on demo/local data unless noted): Calendar,
  Appointments, Clients, Inbox, Work (Leads → Quotes → Jobs → Projects;
  shown to users as Requests/Jobs/Projects depending on the industry),
  Finance, Analytics, Staff, Resources, Waiting List, Settings.
  Notifications (FOUNDATION — see PR in review), AI Assistant (FUTURE;
  a UI shell exists, no AI provider is connected).
- Industry differences (Salon / Workshop / Cleaning / Consulting) come
  from `WorkspaceConfig`; components must not branch on a workspace slug.

---

## 3. Client / booking side

### 3.1 Public booking page (EXISTS)

Every business gets a public booking URL: `/book/[workspaceSlug]`
(e.g. `…/book/auto-mueller`). It works even if the business has **no
website of its own**. The client never needs to install anything or
create an account.

The business can distribute that URL through: Google Business Profile,
Instagram, WhatsApp, Facebook, email, SMS, a QR code, a business card,
or its own website.

### 3.2 Website integration (EXISTS)

If the business has a website there are two options, both already in the
repository — **do not build a second booking engine**:

1. A plain "Book appointment" button/link to the public booking URL.
2. The embeddable booking widget: `public/embed.js` (script loader),
   `/book/[workspaceSlug]/embed` (chromeless booking page that resizes
   its iframe), demo at `/embed-demo`.

### 3.3 Guest booking is the primary flow (EXISTS)

```
business → service → staff (if applicable) → date → available time
        → contact information → confirmation
```

Registering a Client Account is **never required** to book. After a
guest booking we may *offer* "create an account to keep this booking".

### 3.4 Client Account vs ClientRecord — two different things

| | **ClientRecord** | **Client Account** |
|---|---|---|
| What | A person's card **inside one business** (CRM) | A person's own ServiceOS login |
| Scope | One workspace, isolated | Spans businesses |
| Created | Automatically on booking (find-or-create by normalized email/phone within that workspace; ambiguous matches are never auto-merged) | By the person, optionally |
| Status | EXISTS | Local demo only (`src/features/clientAuth`); real accounts **PLANNED** |

One Client Account may later see bookings across businesses ("My
bookings": Auto Müller, Beauty Studio Anna, Zahnarzt Schmidt) while each
business still only sees its own ClientRecord and its own data. **Never
merge the two entities, and never share a ClientRecord across workspaces.**

### 3.5 Future Client App (FUTURE)

A separate ServiceOS Client App is possible later (My bookings,
previously visited businesses, booking management, search, favorites,
notifications). It is **not** a prerequisite for booking — at first the
client arrives by direct URL / QR / widget.

---

## 4. Availability architecture (key decision)

**All booking channels use ONE Availability Engine.** The website widget,
the public booking page, a future Client App, a future marketplace and
the AI Assistant must never compute free time themselves.

### 4.1 Today (EXISTS)

`computeAvailableSlots()` in `src/features/appointments/availability.ts`
is the shared engine: pure, storage-agnostic, built on `findConflicts`
and `checkAvailability`. It is wrapped, not duplicated, by:

- `src/server/services/availability.service.ts` (server wrapper over the
  server repositories),
- `src/features/publicBooking/availability.ts` (browser wrapper over the
  local repositories used by the demo).

Current inputs: the service, eligible staff, candidate resources,
existing appointments, working hours, the date.

### 4.2 Target inputs (FOUNDATION → PLANNED)

Busy time may come from:

- ServiceOS appointments
- working hours
- staff availability
- resources
- **external calendar busy intervals**
- blocking periods / time off
- conflict rules

The integration point is one additional engine input — a list of **busy
intervals** per staff member (and, if needed, per resource) — merged with
the existing ones. Consumers do not change; only what the engine is fed.

### 4.3 External calendars (provider-agnostic)

```
Availability Engine
      ↓
ExternalCalendarService          (application layer)
      ↓
CalendarProvider interface       (our own)
      ↓
GoogleCalendarProvider · MicrosoftCalendarProvider · future providers
```

- Google is **not** hard-coded in the domain/business layer. It is the
  first real provider in the future; Microsoft Outlook / Microsoft 365
  follows; others as needed.
- **Direction 1 — external → ServiceOS (availability):** the owner/staff
  connects a personal or work calendar. ServiceOS does **not** need the
  event title or details — only `BUSY 14:00–15:00` (data minimization;
  also the GDPR-friendly choice). Public booking then doesn't offer that
  slot.
- **Direction 2 — ServiceOS → external (later):** a ServiceOS
  appointment may be written to the calendar as an event.
- **Source of truth:** ServiceOS remains the source of truth for
  ServiceOS appointments.
- **Conflict policy:** if an external event collides with an *existing*
  ServiceOS appointment, **never cancel or move the client
  automatically**. Surface the conflict to the owner and let them decide.

Illustrative shape only (names will be settled in the External Calendar
Foundation task; nothing like this exists in the repo yet):

```ts
interface CalendarProvider {
  readonly id: string;                          // "google" | "microsoft" | …
  getBusyIntervals(account, range): Promise<BusyInterval[]>;   // start/end only
  createEvent?(account, appointment): Promise<ExternalEventRef>;  // later
}
```

---

## 5. Future discovery / city expansion (FUTURE — do not build now)

ServiceOS may later gain a discovery layer: *Pforzheim → Autowerkstatt →
list of businesses*, or "Autowerkstatt near me" — city/category search,
nearby businesses, map, filters, favorites, public business profiles,
reviews/ratings, featured businesses.

The architecture must not block scaling
*Pforzheim → Karlsruhe → Stuttgart → Baden-Württemberg → Germany → other
countries*. Direction for a workspace's public business profile — data
it should be able to carry later (**not necessarily added to the
database now**):

`country`, `region/state`, `city`, `postal code`, `address`,
`coordinates`, `industry/category`, `public slug`,
`discoverable / public-listing setting`.

Rules that keep this open: the public slug stays unique and stable; a
business must be able to stay unlisted (booking by direct URL only);
listing is an explicit owner choice.

---

## 6. Privacy and finance — permanent rule

**Visibility** and **Financial bucket** are two **independent axes**:

- Visibility: `NORMAL` / `PRIVATE` / `OWNER_ONLY` / `CUSTOM`
- Financial bucket: `MAIN` / `PRIVATE` / `CUSTOM`

Never replace them with a single `is_private`; never derive one from the
other. All four visible combinations (Normal/Private × Main/Private) are
valid. The product UI currently shows only Normal/Private and Main/Private
— that is a **UI simplification**; the wider values stay in the domain
model and database, and existing records that carry them must keep
working.

---

## 7. Provider-independent rule — permanent

```
UI → application/service layer → our own interface → provider adapter
```

No direct calls to Google, Supabase, Stripe, OpenAI, an email/SMS vendor
or any other external service from UI components. This applies to
Calendar, Notifications, AI, Payments, Storage, Email/SMS, Auth and
anything added later. (Same rule as in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).)

---

## 8. Order of next stages

1. **Product Architecture** — this document; fixed now.
2. **Booking / Distribution Foundation — NEXT.** Starts with an
   **audit**, not code. `/book/[workspaceSlug]` and the embed widget
   already exist; no new booking engine. The audit checks whether the
   current implementation already supports: a business with **no
   website** of its own; the public booking URL; posting that link on
   Instagram / WhatsApp / Google Business Profile / email / SMS; a QR
   code; a "Book" button on the business's own website; the existing
   embed widget; and **one Availability Engine behind all of these
   channels**. Only after the audit do we decide which minimal
   foundation/code is actually missing.
3. **External Calendar Foundation** — AFTER THAT. Provider-agnostic
   (`ExternalCalendarService` → `CalendarProvider`), busy-interval input
   for the Availability Engine, mock provider only.
4. **Real Google Calendar integration** (OAuth/API) — a separate later
   task that can be handed to a separate developer.

Fixed for every stage: a business website is **not required**; a Client
App is **not required** to book; a Client Account is **not required**
for guest booking; the native Business App is FUTURE and uses the same
backend/API; the future Client App and city discovery/marketplace are
FUTURE; Google Calendar API/OAuth is **not** implemented now.

---

## 9. Decision log

| ID | Decision |
|---|---|
| AD-1 | One backend/data set for web and (future) native Business App |
| AD-2 | Public booking URL `/book/[workspaceSlug]` works without a business website, and without any client account |
| AD-3 | Website integration = link or the existing embed widget; no second booking engine |
| AD-4 | Guest booking is the primary flow; Client Account is optional |
| AD-5 | ClientRecord (per workspace) and Client Account (per person) are separate entities and never merged |
| AD-6 | One Availability Engine for every booking channel; no channel computes free time on its own |
| AD-7 | External calendars via `ExternalCalendarService` → `CalendarProvider`; Google is the first adapter, never hard-coded in domain code |
| AD-8 | External calendars contribute **busy intervals only**; ServiceOS stays source of truth for its appointments |
| AD-9 | External-vs-ServiceOS conflicts are shown to the owner, never auto-resolved against the client |
| AD-10 | Visibility and Financial bucket stay independent axes |
| AD-11 | Provider-independent layering for every external service |
| AD-12 | Discovery/marketplace, Client App, native Business App are FUTURE direction; current design must not block them, current work must not build them |
| AD-13 | A business website, a Client App and a Client Account are all **optional** for booking; the booking URL alone is enough |
| AD-14 | Stage order: Product Architecture → Booking/Distribution (audit first, no new engine) → External Calendar Foundation → real Google Calendar integration |
| AD-15 | Google Calendar API/OAuth is not implemented until the foundation stages are done |
