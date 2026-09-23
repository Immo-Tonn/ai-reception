# ServiceOS Architecture

## Provider-agnostic core (permanent rule)

ServiceOS must never let an external provider become part of the core
application architecture. This applies to every category of third-party
infrastructure: database, auth, storage, AI/LLM, email, payments,
realtime, hosting, analytics, and anything added later.

Required layering, always:

```
UI  →  application/service layer  →  our own interface  →  provider adapter
```

Never:

```
React component  →  Supabase / Stripe / OpenAI / Resend / provider SDK directly
```

Concretely, as each of these gets built:

| Concern  | Service            | Our interface     | Adapter(s) later                          |
| -------- | ------------------- | ------------------ | ------------------------------------------ |
| Data     | `AppointmentService`| `AppointmentRepository` (→ `Repository<T>`) | `SupabaseAppointmentRepository`            |
| Auth     | `AuthService`        | `AuthProvider`      | `SupabaseAuthProvider`                     |
| AI       | `AIService`          | `AIProvider`        | `OpenAIProvider` / `AnthropicProvider` / `LocalModelProvider` |
| Payments | `PaymentService`     | `PaymentProvider`   | `StripeProvider` / `MollieProvider`        |
| Storage  | `StorageService`     | `StorageProvider`   | `SupabaseStorageProvider` / `S3Provider`   |
| Email    | `EmailService`       | `EmailProvider`     | `ResendProvider` / `SesProvider`           |

### Rules

1. Provider SDK calls live only inside an adapter under an infrastructure
   layer — never scattered through components, pages, hooks, or
   `src/server/services/*` business logic. A service or component calls
   the interface, never the SDK.
2. Core business logic must not know which provider is behind the
   interface it's calling.
3. Keep PostgreSQL migrations (`supabase/migrations/`) as portable as
   reasonably possible — plain SQL/DDL, no provider-proprietary
   extensions unless unavoidable.
4. Configuration and secrets are environment-based and provider-specific
   (e.g. `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`) — never hardcoded, never
   imported into a component.
5. Replacing a provider later should only ever cost: (a) a new adapter,
   (b) a configuration change, (c) a data migration if needed. The UI and
   core business logic stay unchanged.
6. Don't add an interface/adapter layer where no external dependency
   exists yet — this rule is about provider boundaries, not blanket
   abstraction. (Example: the demo auth stub in `src/server/auth/session.ts`
   has no real provider behind it yet, so it stays a single plain
   function until real auth is actually wired up.)

### Where this already lives in the codebase

- **Data access**: `src/lib/repository/types.ts` defines `Repository<T>`
  — the one interface every feature talks to. `createLocalRepository`
  (`src/lib/repository/createLocalRepository.ts`, client/localStorage)
  and `createMockRepository` (`src/server/repository/mockRepository.ts`,
  server/in-memory) are today's two adapters; a
  `SupabaseAppointmentRepository` etc. implementing the same
  `Repository<T>` is the intended future adapter. Nothing outside these
  two files touches `localStorage` directly, and nothing outside a
  future Supabase adapter should touch the Supabase client directly.
- **Session/auth**: `src/server/auth/session.ts` — `getSession()` is the
  only thing services import to find out who's calling. Swapping the
  demo cookie-based session for real Supabase Auth means rewriting this
  one file, not every service.
- **Repository registry (server)**: `src/server/repository/registry.ts`
  — factory functions typed as `Repository<T>`, never the concrete
  adapter type, so services never know which implementation they got.
- **Business services**: `src/server/services/*.service.ts` — call
  repositories and `getSession()` only through these interfaces, never
  an SDK.
- **Not yet built** (build behind the same pattern when the time comes):
  `AIService`/`AIProvider`, `PaymentService`/`PaymentProvider`,
  `StorageService`/`StorageProvider`, `EmailService`/`EmailProvider`,
  realtime.

Last audited: 2026-09-22 — no provider SDKs are installed
(`package.json` dependencies are `next`, `react`, `react-dom`,
`server-only`, `zod` only), no direct `localStorage`/`sessionStorage`
access outside `createLocalRepository.ts`, no direct `fetch()` calls to
third-party APIs anywhere in `src/`, no hardcoded secrets. Clean.
