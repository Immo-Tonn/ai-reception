# Sign in / sign up with Google

Business owners and clients can sign in or register with a Google account. It uses Supabase Auth's Google provider: Google checks the person, Supabase creates the session. **The application holds no Google key or secret** (the provider's client id and secret are entered in the Supabase dashboard). It is separate from the Google Calendar integration, which has its own OAuth client and code.

## How it works
1. The form posts to the Server Action `startGoogleSignInAction` (`src/server/actions/googleAuth.actions.ts`). It refuses unless `GOOGLE_LOGIN_ENABLED=true`, applies the sign-up rate limit, builds the callback address from the configured public base URL (`getPublicBaseUrl`, never from request data) and asks Supabase for the Google authorize URL (PKCE; the URL must belong to the Supabase project).
2. Where the person was going (`owner` or `client` and the client return path) is stored in a short-lived httpOnly cookie `sos_google_ctx` — not in the callback URL, which must match the Supabase redirect allow-list exactly.
3. Google returns to Supabase, Supabase returns to **`/auth/callback`** (`src/app/auth/callback/route.ts`) with a one-time code. The route exchanges it for a session and accepts only a **Google identity with a verified e-mail**; anything else is signed out again.
4. Landing: client → the validated `/client…` return path; owner with a workspace → `/<slug>/today`; owner without a workspace → `/signup/google` (asks for the business name, then provisions the workspace for the signed-in account; an existing account is never deleted on failure).
5. Every failure returns to the sign-in page with a stable code (`?google=google_cancelled|google_failed|google_unavailable|google_unverified|rate_limited`); no provider text is shown.

Existing e-mail + password sign-in is unchanged. Accounts that signed up only with Google have no password.

## Switching it on
- Vercel / local env: `GOOGLE_LOGIN_ENABLED=true` (server-only, exact value). Until then no Google button is shown and the entry action refuses.
- Provider setup (Google Cloud and the Supabase dashboard) is described in the team's private documentation.
- After enabling, check with one real Google account: owner sign-up, owner sign-in, client sign-in, cancel at Google.

## Tests
`src/lib/auth/__tests__/googleLogin.test.ts`, `src/server/auth/__tests__/googleSignInCore.test.ts`, `src/app/auth/callback/__tests__/route.test.ts`, `src/server/actions/__tests__/googleAuth.actions.test.ts`, `src/app/(auth)/signup/google/__tests__/actions.test.ts`, `src/__tests__/googleSignIn.static.test.ts`. The real round trip through Google cannot be automated without keys and is the one manual check.
