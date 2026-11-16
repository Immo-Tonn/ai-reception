<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules (added by hand — outside the auto-generated block above)

- **Next.js 16: the request interceptor is `src/proxy.ts` (`export function proxy`), NOT `middleware.ts`.** The project uses a `src/` layout, so the file must sit next to `src/app` — Next looks for it in the parent directory of `app`, and a file in the repo root is silently ignored. Check `package.json` for the Next version and read `node_modules/next/dist/docs/` before relying on any framework convention from memory.
- **After adding any "invisible" file (proxy, instrumentation, config), prove the framework picks it up** — e.g. the dev/build log must list `Proxy`, and a deprecation warning means the name or location is wrong. A file that is merely present proves nothing.
- Supabase: business data is read and written with the signed-in user's own client (`createSupabaseServerClient`) after `getSession(slug)`, so Row Level Security policies apply to every row. The service-role client (`createSupabaseAdminClient`) is only for server-side paths that have no user session (public booking, cron jobs, workspace provisioning, rate limiting); never use it to bypass a policy. Schema changes are new numbered SQL files in `supabase/migrations/` (see the README there); never edit an applied migration, and say explicitly whenever a PR adds one.
