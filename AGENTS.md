<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules (added by hand — outside the auto-generated block above)

- **Next.js 16: the request interceptor is `src/proxy.ts` (`export function proxy`), NOT `middleware.ts`.** The project uses a `src/` layout, so the file must sit next to `src/app` — Next looks for it in the parent directory of `app`, and a file in the repo root is silently ignored. Check `package.json` for the Next version and read `node_modules/next/dist/docs/` before relying on any framework convention from memory.
- **After adding any "invisible" file (proxy, instrumentation, config), prove the framework picks it up** — e.g. the dev/build log must list `Proxy`, and a deprecation warning means the name or location is wrong. A file that is merely present proves nothing.
- Supabase: all business tables are reached only through Server Actions with the `service_role` client after `getSession(slug)`; RLS stays enabled with no policies. Schema changes are SQL files in `supabase/migrations/`, run by hand in the Supabase SQL Editor (no CLI) — say so explicitly whenever a new migration is added.
