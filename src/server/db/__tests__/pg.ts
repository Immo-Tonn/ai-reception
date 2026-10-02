import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite, types } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

/**
 * Test-only harness: an in-process PostgreSQL (PGlite, WASM) that replays
 * supabase/migrations/*.sql from scratch — exactly what a brand-new Supabase
 * project would run. It stubs the three things Supabase provides itself:
 * the roles (anon / authenticated / service_role), `auth.users` and
 * `auth.uid()`. No network, no Supabase project, nothing persistent — safe by
 * construction (it never touches the live `ai-reception` database).
 */
export const migrationsDir = path.resolve(__dirname, "../../../../supabase/migrations");

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
}

export async function createMigratedDb(): Promise<PGlite> {
  const db = new PGlite({
    extensions: { pgcrypto, btree_gist },
    // Like PostgREST: dates and times as plain strings, not JS Date objects.
    parsers: { [types.DATE]: (v: string) => v, [types.TIME]: (v: string) => v },
  });
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    grant select on auth.users to service_role;
  `);
  for (const file of migrationFiles()) {
    await db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
  }
  return db;
}

export type Actor = { kind: "anon" } | { kind: "service" } | { kind: "user"; id: string };

/** Runs `fn` with the session switched to the given database role, then restores it. */
export async function as<T>(db: PGlite, actor: Actor, fn: () => Promise<T>): Promise<T> {
  const role = actor.kind === "anon" ? "anon" : actor.kind === "service" ? "service_role" : "authenticated";
  const sub = actor.kind === "user" ? actor.id : "";
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${sub}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
