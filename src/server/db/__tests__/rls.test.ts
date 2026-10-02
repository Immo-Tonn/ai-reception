import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createMigratedDb } from "./pg";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const STAFF = "cccccccc-0000-4000-8000-000000000003";
const MANAGER = "dddddddd-0000-4000-8000-000000000004";
const ACCOUNTANT = "eeeeeeee-0000-4000-8000-000000000005";

const TABLES = [
  "profiles", "workspaces", "workspace_members", "role_permissions", "clients", "staff_profiles",
  "services", "service_staff", "resources", "working_hours", "financial_buckets", "appointment_series",
  "appointments", "appointment_resources", "waiting_list", "invoices", "invoice_items", "payments", "audit_logs",
];

let db: PGlite;
let wsA: string;
let wsB: string;

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function provision(user: string, email: string, name: string, base: string) {
  const rows = await as(db, { kind: "service" }, () =>
    q<{ out_workspace_id: string; out_slug: string; out_created: boolean }>(
      "select * from public.provision_workspace($1, $2, $3, $4, $5)",
      [user, email, "Owner", name, base],
    ),
  );
  return rows[0];
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id, email) values
    ('${A}', 'a@test.invalid'), ('${B}', 'b@test.invalid'), ('${STAFF}', 's@test.invalid'),
    ('${MANAGER}', 'm@test.invalid'), ('${ACCOUNTANT}', 'c@test.invalid')`);
  wsA = (await provision(A, "a@test.invalid", "Salon A", "salon-a")).out_workspace_id;
  wsB = (await provision(B, "b@test.invalid", "Salon B", "salon-b")).out_workspace_id;
  // Extra members of workspace A with different roles (profiles first).
  await db.exec(`
    insert into profiles (id, email) values
      ('${STAFF}', 's@test.invalid'), ('${MANAGER}', 'm@test.invalid'), ('${ACCOUNTANT}', 'c@test.invalid');
    insert into workspace_members (workspace_id, profile_id, role) values
      ('${wsA}', '${STAFF}', 'staff'), ('${wsA}', '${MANAGER}', 'manager'), ('${wsA}', '${ACCOUNTANT}', 'accountant');
    insert into services (workspace_id, name, duration_minutes) values
      ('${wsA}', 'A-service', 30), ('${wsB}', 'B-service', 30);
  `);
}, 60_000);

describe("migrations replay on an empty database", () => {
  it("enables RLS on every table", async () => {
    const rows = await q<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'",
    );
    for (const table of TABLES) {
      expect(rows.find((r) => r.relname === table)?.relrowsecurity, table).toBe(true);
    }
  });

  it("is re-runnable (idempotent): running 0007-0010 a second time changes nothing and does not fail", async () => {
    const { migrationFiles, migrationsDir } = await import("./pg");
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const before = (await q<{ n: string }>("select count(*)::text n from pg_policies where schemaname='public'"))[0].n;
    for (const file of migrationFiles().filter((f) => f >= "0007")) {
      await db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
    }
    const after = (await q<{ n: string }>("select count(*)::text n from pg_policies where schemaname='public'"))[0].n;
    expect(after).toBe(before);
  });
});

describe("provision_workspace — atomic and idempotent", () => {
  it("creates workspace, owner, MAIN + PRIVATE buckets, owner staff profile, default hours", async () => {
    const [m] = await q("select role from workspace_members where workspace_id = $1 and profile_id = $2", [wsA, A]);
    expect(m.role).toBe("owner");
    const buckets = await q<{ kind: string }>("select kind from financial_buckets where workspace_id = $1 order by kind", [wsA]);
    expect(buckets.map((b) => b.kind)).toEqual(["main", "private"]);
    const staff = await q<{ name: string; profile_id: string }>("select name, profile_id from staff_profiles where workspace_id = $1", [wsA]);
    expect(staff).toEqual([{ name: "You", profile_id: A }]);
    const hours = await q<{ weekday: number; is_day_off: boolean }>(
      "select weekday, is_day_off from working_hours where workspace_id = $1 and staff_id is null order by weekday", [wsA]);
    expect(hours).toHaveLength(7);
    expect(hours.filter((h) => h.is_day_off).map((h) => h.weekday)).toEqual([0, 6]);
    const [w] = await q<{ timezone: string }>("select timezone from workspaces where id = $1", [wsA]);
    expect(w.timezone).toBe("Europe/Berlin");
  });

  it("is idempotent: a retry returns the same workspace and creates nothing", async () => {
    const again = await provision(A, "a@test.invalid", "Another name", "another-slug");
    expect(again.out_workspace_id).toBe(wsA);
    expect(again.out_created).toBe(false);
    const [c] = await q<{ n: string }>("select count(*)::text n from workspaces where created_by = $1", [A]);
    expect(c.n).toBe("1");
    const [b] = await q<{ n: string }>("select count(*)::text n from financial_buckets where workspace_id = $1", [wsA]);
    expect(b.n).toBe("2");
  });

  it("never hands out a reserved, demo or already-taken slug", async () => {
    await db.exec(`insert into auth.users (id, email) values
      ('11111111-0000-4000-8000-000000000001','r1@test.invalid'),
      ('11111111-0000-4000-8000-000000000002','r2@test.invalid'),
      ('11111111-0000-4000-8000-000000000003','r3@test.invalid')`);
    const book = await provision("11111111-0000-4000-8000-000000000001", "r1@test.invalid", "Book", "book");
    const demo = await provision("11111111-0000-4000-8000-000000000002", "r2@test.invalid", "Demo", "demo-salon");
    const taken = await provision("11111111-0000-4000-8000-000000000003", "r3@test.invalid", "Salon A 2", "salon-a");
    expect(book.out_slug).toMatch(/^book-[0-9a-f]{4}$/);
    expect(demo.out_slug).toMatch(/^workspace(-[0-9a-f]{4})?$/); // "demo-*" can never be handed out
    expect(taken.out_slug).toMatch(/^salon-a-[0-9a-f]{4}$/);
  });

  it("the database itself rejects a reserved slug, even for the service role", async () => {
    await expect(
      as(db, { kind: "service" }, () =>
        db.query("insert into workspaces (slug, name) values ('login', 'x')")),
    ).rejects.toThrow(/workspaces_slug_allowed_chk/);
  });

  it("cannot be called by a signed-in user or by anon", async () => {
    for (const actor of [{ kind: "user", id: A } as const, { kind: "anon" } as const]) {
      await expect(
        as(db, actor, () => db.query("select * from public.provision_workspace($1,'x@test.invalid','x','x','x-y-z')", [A])),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe("0015 default privileges (future tables)", () => {
  it("a table created later is reachable by the service role but NOT granted to anon or authenticated", async () => {
    await db.exec("create table public.future_table_probe (id int)");
    const [r] = await q<{ svc: boolean; anon: boolean; auth: boolean }>(
      `select has_table_privilege('service_role','public.future_table_probe','select') as svc,
              has_table_privilege('anon','public.future_table_probe','select') as anon,
              has_table_privilege('authenticated','public.future_table_probe','select') as auth`);
    expect(r).toEqual({ svc: true, anon: false, auth: false });
    await db.exec("drop table public.future_table_probe");
  });
});

describe("tenant isolation (RLS)", () => {
  it("workspace A's owner sees only workspace A", async () => {
    const rows = await as(db, { kind: "user", id: A }, () => q<{ id: string }>("select id from workspaces"));
    expect(rows.map((r) => r.id)).toEqual([wsA]);
    const services = await as(db, { kind: "user", id: A }, () => q<{ name: string }>("select name from services"));
    expect(services.map((s) => s.name)).toEqual(["A-service"]);
  });

  it("cannot read workspace B by guessing its id", async () => {
    const rows = await as(db, { kind: "user", id: A }, () => q("select * from services where workspace_id = $1", [wsB]));
    expect(rows).toHaveLength(0);
  });

  it("cannot insert into workspace B", async () => {
    await expect(
      as(db, { kind: "user", id: A }, () =>
        db.query("insert into services (workspace_id, name, duration_minutes) values ($1, 'evil', 10)", [wsB])),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot move a row into workspace B by updating workspace_id", async () => {
    await expect(
      as(db, { kind: "user", id: A }, () =>
        db.query("update services set workspace_id = $1 where name = 'A-service'", [wsB])),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot update or delete workspace B's rows (0 rows affected)", async () => {
    const upd = await as(db, { kind: "user", id: A }, () => db.query("update services set name = 'pwned' where workspace_id = $1", [wsB]));
    const del = await as(db, { kind: "user", id: A }, () => db.query("delete from services where workspace_id = $1", [wsB]));
    expect(upd.affectedRows).toBe(0);
    expect(del.affectedRows).toBe(0);
    const [still] = await q<{ name: string }>("select name from services where workspace_id = $1", [wsB]);
    expect(still.name).toBe("B-service");
  });

  it("cannot read other workspaces' members, buckets, staff or hours", async () => {
    for (const t of ["workspace_members", "financial_buckets", "staff_profiles", "working_hours"]) {
      const rows = await as(db, { kind: "user", id: A }, () => q(`select * from ${t} where workspace_id = $1`, [wsB]));
      expect(rows, t).toHaveLength(0);
    }
  });

  it("cannot read other users' profiles", async () => {
    const rows = await as(db, { kind: "user", id: A }, () => q<{ id: string }>("select id from profiles where id = $1", [B]));
    expect(rows).toHaveLength(0);
  });

  it("a signed-in user cannot forge membership, create workspaces or profiles directly", async () => {
    const attempts: [string, unknown[]][] = [
      ["insert into workspace_members (workspace_id, profile_id, role) values ($1, $2, 'owner')", [wsB, A]],
      ["insert into workspaces (slug, name) values ('sneaky-new-ws', 'x')", []],
      ["insert into profiles (id, email) values ('99999999-0000-4000-8000-000000000009', 'x@test.invalid')", []],
      ["insert into financial_buckets (workspace_id, name, slug, kind) values ($1, 'x', 'x', 'custom')", [wsB]],
    ];
    for (const [sql, params] of attempts) {
      await expect(as(db, { kind: "user", id: A }, () => db.query(sql, params)), sql).rejects.toThrow(/row-level security/);
    }
    // ...and a plain member cannot promote themselves
    const promote = await as(db, { kind: "user", id: STAFF }, () => db.query("update workspace_members set role = 'owner' where profile_id = $1", [STAFF]));
    expect(promote.affectedRows).toBe(0);
  });

  it("anon reads and writes nothing, anywhere", async () => {
    for (const t of TABLES) {
      const rows = await as(db, { kind: "anon" }, () => q(`select * from ${t}`).catch(() => []));
      expect(rows, t).toHaveLength(0);
    }
    await expect(
      as(db, { kind: "anon" }, () => db.query("insert into services (workspace_id, name, duration_minutes) values ($1,'x',1)", [wsA])),
    ).rejects.toThrow();
  });

  it("tables of not-yet-migrated features are deny-all for signed-in users", async () => {
    await db.exec(`insert into invoices (workspace_id, number) values ('${wsA}', 'INV-1')`);
    for (const t of ["invoices", "invoice_items", "payments", "waiting_list"]) {
      const rows = await as(db, { kind: "user", id: A }, () => q(`select * from ${t}`));
      expect(rows, t).toHaveLength(0);
    }
  });
});

describe("roles and permissions", () => {
  it("staff can read services but not change them", async () => {
    const rows = await as(db, { kind: "user", id: STAFF }, () => q("select * from services"));
    expect(rows.length).toBeGreaterThan(0);
    await expect(
      as(db, { kind: "user", id: STAFF }, () => db.query("insert into services (workspace_id, name, duration_minutes) values ($1,'s',5)", [wsA])),
    ).rejects.toThrow(/row-level security/);
    const upd = await as(db, { kind: "user", id: STAFF }, () => db.query("update services set name='x'"));
    expect(upd.affectedRows).toBe(0);
  });

  it("financial buckets: PRIVATE is visible only with the private permission (axes stay independent)", async () => {
    const kinds = async (id: string) =>
      (await as(db, { kind: "user", id }, () => q<{ kind: string }>("select kind from financial_buckets order by kind"))).map((r) => r.kind);
    expect(await kinds(A)).toEqual(["main", "private"]); // owner
    expect(await kinds(ACCOUNTANT)).toEqual(["main", "private"]);
    expect(await kinds(MANAGER)).toEqual(["main"]); // manager: main only
    expect(await kinds(STAFF)).toEqual([]); // staff: none
  });

  it("members can read the roster of their own workspace only", async () => {
    const rows = await as(db, { kind: "user", id: STAFF }, () => q<{ workspace_id: string }>("select distinct workspace_id from workspace_members"));
    expect(rows.map((r) => r.workspace_id)).toEqual([wsA]);
  });

  it("co-members can read each other's profile", async () => {
    const rows = await as(db, { kind: "user", id: STAFF }, () => q<{ id: string }>("select id from profiles where id = $1", [A]));
    expect(rows).toHaveLength(1);
  });
});

describe("identity is immutable for signed-in users", () => {
  it("cannot change a workspace slug", async () => {
    await expect(
      as(db, { kind: "user", id: A }, () => db.query("update workspaces set slug = 'new-slug-xyz' where id = $1", [wsA])),
    ).rejects.toThrow(/workspace_identity_immutable/);
  });

  it("can rename a workspace and edit own profile name, but not the profile email", async () => {
    const r = await as(db, { kind: "user", id: A }, () => db.query("update workspaces set name = 'Renamed' where id = $1", [wsA]));
    expect(r.affectedRows).toBe(1);
    await as(db, { kind: "user", id: A }, () => db.query("update profiles set full_name = 'Me' where id = $1", [A]));
    await expect(
      as(db, { kind: "user", id: A }, () => db.query("update profiles set email = 'steal@test.invalid' where id = $1", [A])),
    ).rejects.toThrow(/profile_identity_immutable/);
  });

  it("staff cannot rename the workspace (settings.manage required)", async () => {
    const r = await as(db, { kind: "user", id: STAFF }, () => db.query("update workspaces set name = 'x' where id = $1", [wsA]));
    expect(r.affectedRows).toBe(0);
  });
});

describe("complete_onboarding — once, with permission", () => {
  const services = JSON.stringify([
    { name: "Haircut", durationMinutes: 45, price: 55 },
    { name: "  ", durationMinutes: 10, price: 1 },
    { name: "Color", durationMinutes: 90, price: 95 },
  ]);

  it("rejects a user without settings.manage and a user from another workspace", async () => {
    await expect(
      as(db, { kind: "user", id: STAFF }, () => db.query("select public.complete_onboarding($1,'beauty','appointments',$2)", [wsA, services])),
    ).rejects.toThrow(/forbidden/);
    await expect(
      as(db, { kind: "user", id: A }, () => db.query("select public.complete_onboarding($1,'beauty','appointments',$2)", [wsB, services])),
    ).rejects.toThrow(/forbidden/);
  });

  it("applies once; a second call changes nothing", async () => {
    const run = () => as(db, { kind: "user", id: A }, async () =>
      (await q<{ complete_onboarding: boolean }>("select public.complete_onboarding($1,'beauty','appointments',$2) as complete_onboarding", [wsA, services]))[0].complete_onboarding);
    const before = (await q<{ n: string }>("select count(*)::text n from services where workspace_id = $1", [wsA]))[0].n;
    expect(await run()).toBe(true);
    const mid = (await q<{ n: string }>("select count(*)::text n from services where workspace_id = $1", [wsA]))[0].n;
    expect(Number(mid) - Number(before)).toBe(2); // blank name skipped
    expect(await run()).toBe(false);
    const after = (await q<{ n: string }>("select count(*)::text n from services where workspace_id = $1", [wsA]))[0].n;
    expect(after).toBe(mid);
    const [w] = await q<{ industry: string; booking_mode: string; onboarding_completed_at: string | null }>(
      "select industry, booking_mode, onboarding_completed_at from workspaces where id = $1", [wsA]);
    expect(w.industry).toBe("beauty");
    expect(w.onboarding_completed_at).not.toBeNull();
  });

  it("rejects invalid input without partially writing", async () => {
    await expect(
      as(db, { kind: "user", id: B }, () => db.query("select public.complete_onboarding($1,'beauty','nonsense',$2)", [wsB, "[]"])),
    ).rejects.toThrow(/invalid_input/);
    const [w] = await q<{ onboarding_completed_at: string | null }>("select onboarding_completed_at from workspaces where id = $1", [wsB]);
    expect(w.onboarding_completed_at).toBeNull();
  });
});
