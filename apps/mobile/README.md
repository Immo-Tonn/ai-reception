# ServiceOS — Mobile (Expo foundation)

**Foundation only — not a store-ready app.** No feature parity with the
web app, no backend connection, no real auth, no signing.

## What this is

React Native + Expo (Expo Router), TypeScript. Proves the native shell
works: navigation, theming, localization, config — ready for a future
team to build real screens on top of, without inventing that scaffolding
from scratch.

## Run it

```bash
cd apps/mobile
npm install   # already run once; re-run after pulling dependency changes
npm run start # then press i / a / w, or scan the QR code with Expo Go
npm run typecheck
```

## What's here

- `app/` — Expo Router file-based routes: `index` (Welcome), `business`,
  `client`, `login` (all placeholders — see each file's comment).
- `src/theme/` — Light/Dark/System foundation (`useTheme()`), same
  conceptual palette as the web app's design tokens.
- `src/i18n/` — DE/EN/UK/RU foundation (`useI18n()`), device-locale
  detection via `expo-localization`.
- `src/lib/config.ts` — env/config abstraction; the rest of the app
  never reads `Constants.expoConfig` directly.
- `src/components/` — `Screen`, `BackHeader`, `ActionRow` — shared
  building blocks so the placeholder screens don't duplicate markup.
- `app.config.ts` — app name, **provisional** iOS bundle id / Android
  package (`com.serviceos.app` — update before any real build), deep
  link scheme `serviceos://`.
- `eas.json` — build profile shells (`development`/`preview`/
  `production`). No credentials, no project id.

## What's NOT here (by design)

Supabase, real auth (Apple/Google/email), push notifications, payments,
AI, Calendar/Finance/CRM screens, signing certificates/keystores, any
App Store/Play Store submission.

## Architecture boundary

Same rule as the web app: UI never talks to a backend/provider directly.

```
Native UI → application/service interfaces → provider adapters
```

Nothing here duplicates ServiceOS business logic — there isn't any yet
on the native side, on purpose. When a backend exists, adapters get
built behind these same interfaces; screens don't get rewritten.

Assets in `assets/` are the default Expo template icon/splash —
temporary placeholders, not ServiceOS branding (no production icon/
splash asset exists yet on the web side to reuse).
