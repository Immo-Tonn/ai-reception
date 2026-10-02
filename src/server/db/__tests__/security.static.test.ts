import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { migrationFiles, migrationsDir } from "./pg";

const root = path.resolve(__dirname, "../../../..");
const read = (file: string) => readFileSync(file, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "dist"].includes(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const rel = (f: string) => path.relative(root, f).replaceAll(path.sep, "/");

describe("migrations — static policy checks", () => {
  const files = migrationFiles();
  const sqlOf = (f: string) => read(path.join(migrationsDir, f));

  it("are consecutively numbered with no gaps or duplicates", () => {
    const numbers = files.map((f) => Number(f.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("new migrations (0007+) never drop, truncate or delete data", () => {
    for (const f of files.filter((f) => f >= "0007")) {
      // The one legitimate delete: pruning expired rows of the rate-limit table itself.
      const sql = sqlOf(f).replace(/--.*$/gm, "").replace(/delete\s+from\s+public\.rate_limits\s+where\s+window_start/gi, "");
      expect(sql, f).not.toMatch(/\bdrop\s+(table|schema|column|type|extension)\b/i);
      expect(sql, f).not.toMatch(/\btruncate\b/i);
      expect(sql, f).not.toMatch(/\bdelete\s+from\b/i);
      expect(sql, f).not.toMatch(/\balter\s+table\s+\S+\s+drop\b/i);
    }
  });

  it("every SECURITY DEFINER function pins search_path", () => {
    for (const f of files) {
      const sql = sqlOf(f);
      const fns = sql.split(/create (?:or replace )?function/i).slice(1);
      for (const body of fns) {
        const head = body.split(/\$\$/)[0];
        if (/security\s+definer/i.test(head)) expect(head, f).toMatch(/set\s+search_path\s*=\s*''/i);
      }
    }
  });

  it("no policy is granted to anon or PUBLIC; policies never name the service role", () => {
    const sql = sqlOf("0009_rls_helpers_and_policies.sql");
    const policies = sql.match(/create policy[\s\S]*?;/gi) ?? [];
    expect(policies.length).toBeGreaterThan(15);
    for (const p of policies) {
      expect(p).toMatch(/to authenticated/i);
      const roles = p.match(/\bto\s+([a-z_, ]+?)\s+(?:using|with\s+check)/i)?.[1].trim();
      expect(roles).toBe("authenticated"); // never anon / public / service_role
      expect(p).not.toMatch(/service_role/i);
    }
  });

  it("the only unconditional policy is the non-sensitive role_permissions reference matrix", () => {
    const policies = (sqlOf("0009_rls_helpers_and_policies.sql").match(/create policy[\s\S]*?;/gi) ?? []).filter((p) => /using\s*\(\s*true\s*\)/i.test(p));
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/role_permissions/);
  });

  it("provisioning is callable only by the service role", () => {
    const sql = sqlOf("0010_provisioning_and_onboarding.sql");
    expect(sql).toMatch(/revoke all on function public\.provision_workspace[\s\S]*?from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.provision_workspace[\s\S]*?to service_role/i);
  });

  it("do not hard-code a project (no URLs, ids, keys, e-mail addresses)", () => {
    for (const f of files) {
      const sql = sqlOf(f);
      expect(sql, f).not.toMatch(/https?:\/\//i);
      expect(sql, f).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      expect(sql, f).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/);
    }
  });

  it("double-booking protection is declared in the migrations (staff AND resource exclusion, trigger-computed windows)", () => {
    const sql = sqlOf("0011_booking_integrity.sql");
    expect(sql).toMatch(/appointments_no_staff_overlap[\s\S]*?exclude using gist \(staff_id with =/i);
    expect(sql).toMatch(/appointments_no_resource_overlap[\s\S]*?exclude using gist \(resource_id with =/i);
    expect(sql).toMatch(/create trigger appointments_set_busy_range/i);
    expect(sql).toMatch(/pending[\s\S]*confirmed[\s\S]*checked_in[\s\S]*in_progress/);
    expect(sql).toMatch(/guard_workspace_references/);
  });

  it("guest booking functions and the rate limiter are service-role only; the limiter table has RLS and no policy", () => {
    const booking = sqlOf("0013_public_booking.sql");
    for (const fn of ["get_public_booking_catalog", "get_public_busy", "create_public_booking"]) {
      expect(booking, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}[\\s\\S]*?from public, anon, authenticated`, "i"));
      expect(booking, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*?to service_role`, "i"));
    }
    const rl = sqlOf("0014_rate_limits.sql");
    expect(rl).toMatch(/alter table public\.rate_limits enable row level security/i);
    expect(rl).not.toMatch(/create policy/i);
    expect(rl).toMatch(/grant execute on function public\.rate_limit_hit[\s\S]*?to service_role/i);
  });

  it("the public booking function never takes price, status, visibility or bucket from the caller", () => {
    const sql = sqlOf("0013_public_booking.sql");
    const signature = sql.match(/create or replace function public\.create_public_booking\(([\s\S]*?)\)\s*returns/i)![1];
    for (const forbidden of ["price", "status", "visibility", "bucket", "duration", "ends"]) {
      expect(signature, forbidden).not.toMatch(new RegExp(`p_[a-z_]*${forbidden}`, "i"));
    }
  });

  it("0015 grants default privileges to the service role ONLY (never anon/authenticated) and changes no RLS", () => {
    const sql = sqlOf("0015_service_role_default_privileges.sql").replace(/--.*$/gm, "");
    const grants = sql.match(/grant[\s\S]*?;/gi) ?? [];
    expect(grants.length).toBeGreaterThanOrEqual(4);
    for (const g of grants) {
      expect(g).toMatch(/to service_role;/i);
      expect(g).not.toMatch(/(anon|authenticated)/i);
    }
    expect(sql).not.toMatch(/row level security|create policy|drop policy|revoke/i);
  });

  it("keep Visibility and Financial Account as two independent columns (never one is_private flag)", () => {
    const all = files.map(sqlOf).join("\n").replace(/--.*$/gm, ""); // comments may mention the rule
    expect(all).not.toMatch(/\bis_private\b/i);
    expect(sqlOf("0004_scheduling.sql")).toMatch(/visibility\s+appointment_visibility/);
    expect(sqlOf("0004_scheduling.sql")).toMatch(/financial_bucket_id\s+uuid/);
  });
});

describe("service-role and secret hygiene", () => {
  const sources = walk(path.join(root, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"));

  it("the service-role client is imported only by the allowed server modules", () => {
    const importers = sources.filter((f) => /createSupabaseAdminClient/.test(read(f))).map(rel).sort();
    expect(importers).toEqual([
      "src/lib/supabase/admin.ts",
      "src/server/auth/supabaseBusinessAuth.ts", // roll back a half-made sign-up
      "src/server/booking/deps.ts", // guest booking (3 whitelisted DB functions)
      "src/server/booking/pageData.ts", // public catalog for the booking page (same function)
      "src/server/ratelimit/index.ts", // PostgreSQL rate limiter
      "src/server/services/provisioning.service.ts", // provision_workspace
    ]);
  });

  it("the service-role key is read in exactly one file and never behind NEXT_PUBLIC_", () => {
    const readers = sources.filter((f) => read(f).includes("SUPABASE_SERVICE_ROLE_KEY")).map(rel);
    expect(readers).toEqual(["src/lib/supabase/admin.ts"]);
    for (const f of walk(root).filter((f) => !f.includes("node_modules") && !f.includes("/.next/"))) {
      if (/\.(ts|tsx|js|md|sql|json)$/.test(f)) expect(read(f), rel(f)).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/);
    }
  });

  it("Supabase client code is server-only and never imported from a client component", () => {
    for (const f of sources) {
      const text = read(f);
      if (/^\s*["']use client["']/m.test(text.split("\n").slice(0, 3).join("\n"))) {
        expect(text, rel(f)).not.toMatch(/@\/lib\/supabase|@supabase\//);
      }
    }
    for (const name of ["admin.ts", "server.ts"]) expect(read(path.join(root, "src/lib/supabase", name))).toMatch(/import "server-only"/);
  });

  it("no UI component queries Supabase directly (UI -> action -> service -> repository -> adapter)", () => {
    const ui = sources.filter((f) => rel(f).startsWith("src/app/") || rel(f).startsWith("src/components/"));
    const offenders = ui.filter((f) => /\.from\(["'`]\w+["'`]\)/.test(read(f)) && /supabase/i.test(read(f))).map(rel);
    // Auth route actions read the user's own memberships right after login; that is the only allowed spot.
    expect(offenders).toEqual(["src/app/(auth)/login/actions.ts"]);
  });

  it("no secrets or project identifiers are committed (keys, JWTs, supabase.co hosts)", () => {
    const scan = walk(root).filter(
      (f) => !/node_modules|\.next|\.git\/|package-lock|\.png|\.ico|\.webp|\.jpg/.test(f) && !path.basename(f).startsWith(".env.local"),
    );
    for (const f of scan) {
      if (!/\.(ts|tsx|js|json|md|sql|css|example|toml|yml|yaml)$/.test(f) && !f.endsWith(".env.example")) continue;
      const text = read(f);
      expect(text, rel(f)).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./); // JWT (anon/service keys)
      expect(text, rel(f)).not.toMatch(/sb_(secret|publishable)_[A-Za-z0-9_-]{10,}/);
      expect(text, rel(f)).not.toMatch(/https:\/\/[a-z0-9]{15,}\.supabase\.co/);
    }
  });

  it(".env.example lists names only — no values", () => {
    const lines = read(path.join(root, ".env.example")).split("\n").filter((l) => /^[A-Z_]+=/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) expect(l, l).toMatch(/^[A-Z_]+=$/);
    const names = lines.map((l) => l.replace("=", ""));
    for (const n of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_APP_URL"]) {
      expect(names).toContain(n);
    }
  });
});
