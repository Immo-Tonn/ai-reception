import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createMigratedDb, migrationsDir, type Actor } from "./pg";
import { lineTotalMinor, minorToDecimalString } from "@/lib/money";

/**
 * Migration 0022 (Finance) against a REAL PostgreSQL (PGlite replaying every migration):
 * numbering, line items + derived total, payments + status, privacy matrix, cross-workspace guards,
 * tenant isolation, restrict-delete. PGlite has ONE connection, so "concurrent" creates are serialised
 * by the engine; the numbering tests therefore prove the counter logic (no duplicates, gapless, rollback),
 * while row-level locking itself is what Postgres guarantees for INSERT .. ON CONFLICT DO UPDATE.
 */
const OWNER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const ADMIN = "aaaaaaaa-0000-4000-8000-0000000000a2";
const MANAGER = "aaaaaaaa-0000-4000-8000-0000000000a3";
const STAFF = "aaaaaaaa-0000-4000-8000-0000000000a4";
const ACCOUNTANT = "aaaaaaaa-0000-4000-8000-0000000000a5";
const OWNER_B = "bbbbbbbb-0000-4000-8000-0000000000b1";
const OWNER_C = "cccccccc-0000-4000-8000-0000000000c1";

const user = (id: string): Actor => ({ kind: "user", id });
const svc: Actor = { kind: "service" };
const anon: Actor = { kind: "anon" };

let db: PGlite;
let wsA: string, wsB: string;
let clientA: string, clientB: string, apptB: string, apptA: string;
let privA: string, customA: string, customB: string;

const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const run = <T = Record<string, unknown>>(actor: Actor, sql: string, p: unknown[] = []) =>
  as(db, actor, async () => (await db.query<T>(sql, p)).rows);
const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code ?? "no-code";
  }
};
const messageOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};

type Item = { description: string; quantity: string | number; unit_price: string | number };
const line = (description: string, quantity: string | number, unit_price: string | number): Item => ({ description, quantity, unit_price });

interface CreateOpts {
  ws?: string;
  client?: string | null;
  appointment?: string | null;
  bucketKind?: string;
  bucketId?: string | null;
  visibility?: string;
  status?: string;
  currency?: string | null;
  due?: string | null;
  items?: Item[];
}
async function createInvoice(actor: Actor, o: CreateOpts = {}): Promise<string> {
  const rows = await run<{ create_invoice: string }>(
    actor,
    "select public.create_invoice($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as create_invoice",
    [
      o.ws ?? wsA,
      o.client ?? null,
      "Walk-in",
      o.appointment ?? null,
      o.bucketKind ?? "main",
      o.bucketId ?? null,
      o.visibility ?? "normal",
      o.status ?? "sent",
      o.currency ?? null,
      null,
      o.due ?? null,
      "",
      JSON.stringify(o.items ?? [line("Service", 1, "100.00")]),
    ],
  );
  return rows[0].create_invoice;
}
const inv = async (id: string) => (await q<{ amount: string; status: string; number: string; visibility: string; financial_bucket_id: string | null }>("select * from invoices where id=$1", [id]))[0];
const pay = (actor: Actor, id: string, amount: string | number, method = "cash") =>
  run(actor, "select public.record_payment($1,$2,$3,null) as id", [id, amount, method]);

/** The invariant of this migration, checked after the scenarios: amount == sum of rounded lines, for EVERY invoice. */
async function assertTotalsConsistent() {
  const bad = await q(
    `select i.id from invoices i
     where i.amount <> coalesce((select sum(round(it.quantity * it.unit_price, 2)) from invoice_items it where it.invoice_id = i.id), 0)`,
  );
  expect(bad).toEqual([]);
}

beforeAll(async () => {
  db = await createMigratedDb();
  const emails: Record<string, string> = { [OWNER]: "o", [ADMIN]: "ad", [MANAGER]: "m", [STAFF]: "s", [ACCOUNTANT]: "ac", [OWNER_B]: "b", [OWNER_C]: "c" };
  for (const [id, e] of Object.entries(emails)) await q("insert into auth.users (id,email) values ($1,$2)", [id, `${e}@t.invalid`]);
  const prov = async (uid: string, name: string, slug: string) =>
    (await run<{ out_workspace_id: string }>(svc, "select * from public.provision_workspace($1,$2,'',$3,$4,'en')", [uid, `${emails[uid]}@t.invalid`, name, slug]))[0].out_workspace_id;
  wsA = await prov(OWNER, "Biz A", "fin-a");
  wsB = await prov(OWNER_B, "Biz B", "fin-b");
  for (const [uid, role] of [[ADMIN, "admin"], [MANAGER, "manager"], [STAFF, "staff"], [ACCOUNTANT, "accountant"]] as const) {
    await q("insert into profiles (id,email) values ($1,$2) on conflict do nothing", [uid, `${emails[uid]}@t.invalid`]);
    await q("insert into workspace_members (workspace_id,profile_id,role) values ($1,$2,$3)", [wsA, uid, role]);
  }
  clientA = (await q<{ id: string }>("insert into clients (workspace_id,name,email) values ($1,'Anna A','a@x.test') returning id", [wsA]))[0].id;
  clientB = (await q<{ id: string }>("insert into clients (workspace_id,name,email) values ($1,'Bob B','b@x.test') returning id", [wsB]))[0].id;
  const staffA = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsA]))[0].id;
  const staffB = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsB]))[0].id;
  const appt = (ws: string, st: string, c: string) =>
    q<{ id: string }>("insert into appointments (workspace_id,staff_id,client_id,starts_at,ends_at) values ($1,$2,$3,now()+interval '9 day',now()+interval '9 day 1 hour') returning id", [ws, st, c]);
  apptA = (await appt(wsA, staffA, clientA))[0].id;
  apptB = (await appt(wsB, staffB, clientB))[0].id;
  const bucket = async (ws: string, kind: string) => (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind=$2", [ws, kind]))[0].id;
  privA = await bucket(wsA, "private");
  customA = (await q<{ id: string }>("insert into financial_buckets (workspace_id,name,slug,kind) values ($1,'Side','side','custom') returning id", [wsA]))[0].id;
  customB = (await q<{ id: string }>("insert into financial_buckets (workspace_id,name,slug,kind) values ($1,'SideB','side','custom') returning id", [wsB]))[0].id;
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("migration replay", () => {
  it("is idempotent: running 0022 again changes nothing and does not fail", async () => {
    const sql = readFileSync(path.join(migrationsDir, "0022_finance_invoices.sql"), "utf8");
    await db.exec(sql);
    await db.exec(sql);
  });
});

describe("invoice numbering", () => {
  it("N concurrent creates get N distinct, gapless numbers INV-{year}-{0001..}", async () => {
    const N = 12;
    const ids = await Promise.all(Array.from({ length: N }, () => createInvoice(user(OWNER), { items: [line("x", 1, "1.00")] })));
    expect(new Set(ids).size).toBe(N);
    const year = Number((await q<{ y: string }>("select extract(year from now() at time zone 'Europe/Berlin')::int::text y"))[0].y);
    const numbers = (await q<{ number: string }>("select number from invoices where workspace_id=$1 order by number", [wsA])).map((r) => r.number);
    expect(numbers).toEqual(Array.from({ length: N }, (_, i) => `INV-${year}-${String(i + 1).padStart(4, "0")}`));
  });

  it("numbers are per workspace: workspace B starts at 0001 too", async () => {
    const id = await createInvoice(user(OWNER_B), { ws: wsB });
    expect((await inv(id)).number).toMatch(/^INV-\d{4}-0001$/);
  });

  it("a failed create rolls the counter back (no gap, no burnt number)", async () => {
    const before = Number((await q<{ n: string }>("select last_value::text n from invoice_counters where workspace_id=$1", [wsA]))[0].n);
    const code = await codeOf(createInvoice(user(OWNER), { items: [line("bad", 0, "1.00")] })); // quantity > 0 check
    expect(code).toBe("23514");
    const after = Number((await q<{ n: string }>("select last_value::text n from invoice_counters where workspace_id=$1", [wsA]))[0].n);
    expect(after).toBe(before);
  });

  it("a hand-made number that already exists is skipped, never duplicated", async () => {
    const next = (await run<{ n: string }>(user(OWNER), "select public.next_invoice_number($1) n", [wsA]))[0].n;
    // pretend an import used the number that is about to be handed out next
    const nextNext = next.replace(/\d{4}$/, (d) => String(Number(d) + 1).padStart(4, "0"));
    await q("insert into invoices (workspace_id, number, status) values ($1,$2,'draft')", [wsA, nextNext]);
    const after = (await run<{ n: string }>(user(OWNER), "select public.next_invoice_number($1) n", [wsA]))[0].n;
    expect(after).not.toBe(nextNext);
    expect(after).not.toBe(next);
  });

  it("unique (workspace_id, number) is the last line of defence", async () => {
    const existing = (await q<{ number: string }>("select number from invoices where workspace_id=$1 limit 1", [wsA]))[0].number;
    expect(await codeOf(q("insert into invoices (workspace_id, number) values ($1,$2)", [wsA, existing]))).toBe("23505");
  });

  it("only finance.edit may draw a number; anon and other workspaces may not", async () => {
    for (const id of [ACCOUNTANT, MANAGER, STAFF]) {
      expect(await codeOf(run(user(id), "select public.next_invoice_number($1)", [wsA]))).toBe("42501");
    }
    expect(await codeOf(run(user(OWNER_B), "select public.next_invoice_number($1)", [wsA]))).toBe("42501");
    expect(await codeOf(run(anon, "select public.next_invoice_number($1)", [wsA]))).toBe("42501");
  });
});

describe("line items and the derived total", () => {
  it("0.1 + 0.2 style: 0.10 + 0.20 is exactly 0.30", async () => {
    const id = await createInvoice(user(OWNER), { items: [line("a", 1, "0.10"), line("b", 1, "0.20")] });
    expect((await inv(id)).amount).toBe("0.30");
  });

  it("quantity decimals and half-up rounding once per line (3 lines)", async () => {
    // 1.5 x 19.99 = 29.985 -> 29.99 ; 1.005 x 1.00 -> 1.01 (twice) ; sum of ROUNDED lines = 32.01 (not round(32.005))
    const id = await createInvoice(user(OWNER), { items: [line("a", "1.500", "19.99"), line("b", "1.005", "1.00"), line("c", "1.005", "1.00")] });
    expect((await inv(id)).amount).toBe("32.01");
    const lines = await q<{ t: string }>("select round(quantity*unit_price,2)::text t from invoice_items where invoice_id=$1 order by position", [id]);
    expect(lines.map((l) => l.t)).toEqual(["29.99", "1.01", "1.01"]);
  });

  it("SQL and the TypeScript money helper agree on 150 random lines", async () => {
    const qtys: string[] = [];
    const prices: string[] = [];
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 150; i++) {
      qtys.push((Math.floor(rnd() * 20000) / 1000 + 0.001).toFixed(3));
      prices.push((Math.floor(rnd() * 100000) / 100).toFixed(2));
    }
    const rows = await q<{ t: string }>(
      "select round(q::numeric * p::numeric, 2)::text t from unnest($1::text[], $2::text[]) as x(q, p)",
      [qtys, prices],
    );
    rows.forEach((r, i) => expect(r.t, `${qtys[i]} x ${prices[i]}`).toBe(minorToDecimalString(lineTotalMinor(qtys[i], prices[i]))));
  });

  it("the total follows every item change; a direct write of amount is overridden", async () => {
    const id = await createInvoice(user(OWNER), { items: [line("a", 2, "10.00")] });
    expect((await inv(id)).amount).toBe("20.00");
    await run(user(OWNER), "insert into invoice_items (invoice_id, description, quantity, unit_price) values ($1,'b',1,'5.50')", [id]);
    expect((await inv(id)).amount).toBe("25.50");
    await run(user(OWNER), "update invoice_items set quantity = 3 where invoice_id=$1 and description='a'", [id]);
    expect((await inv(id)).amount).toBe("35.50");
    await run(user(OWNER), "delete from invoice_items where invoice_id=$1 and description='b'", [id]);
    expect((await inv(id)).amount).toBe("30.00");
    await run(user(OWNER), "update invoices set amount = 999 where id=$1", [id]);
    expect((await inv(id)).amount).toBe("30.00");
    await run(user(OWNER), "select public.replace_invoice_items($1,$2)", [id, JSON.stringify([line("only", 1, "1.00")])]);
    expect((await inv(id)).amount).toBe("1.00");
    expect((await q("select 1 from invoice_items where invoice_id=$1", [id])).length).toBe(1);
  });

  it("an invoice with no lines is 0.00 and cannot be paid", async () => {
    const id = await createInvoice(user(OWNER), { items: [] });
    expect((await inv(id)).amount).toBe("0.00");
    expect(await messageOf(pay(user(OWNER), id, "1.00"))).toMatch(/overpayment/);
  });

  it("invalid lines are refused by the database (blank text, negative price)", async () => {
    expect(await codeOf(createInvoice(user(OWNER), { items: [line("  ", 1, "1.00")] }))).toBe("23514");
    expect(await codeOf(createInvoice(user(OWNER), { items: [line("x", 1, "-1.00")] }))).toBe("23514");
  });

  it("currency defaults to the workspace currency and is stored on the invoice", async () => {
    const id = await createInvoice(user(OWNER));
    const ws = (await q<{ default_currency: string }>("select default_currency from workspaces where id=$1", [wsA]))[0].default_currency;
    expect((await q<{ currency: string }>("select currency from invoices where id=$1", [id]))[0].currency).toBe(ws);
    const usd = await createInvoice(user(OWNER), { currency: "usd" });
    expect((await q<{ currency: string }>("select currency from invoices where id=$1", [usd]))[0].currency).toBe("USD");
  });
});

describe("payments and status", () => {
  it("sent -> partially_paid -> paid; overpayment refused; mark unpaid voids but keeps history", async () => {
    const id = await createInvoice(user(OWNER), { items: [line("a", 1, "100.00")] });
    expect((await inv(id)).status).toBe("sent");
    await pay(user(OWNER), id, "30.00", "card");
    expect((await inv(id)).status).toBe("partially_paid");
    expect(await messageOf(pay(user(OWNER), id, "70.01"))).toMatch(/overpayment/);
    await pay(user(OWNER), id, "70.00", "bank_transfer");
    expect((await inv(id)).status).toBe("paid");
    // a paid invoice is locked
    expect(await messageOf(run(user(OWNER), "select public.replace_invoice_items($1,$2)", [id, JSON.stringify([line("z", 1, "1.00")])]))).toMatch(/invoice_locked/);
    const n = (await run<{ n: number }>(user(OWNER), "select public.void_invoice_payments($1) n", [id]))[0].n;
    expect(n).toBe(2);
    expect((await inv(id)).status).toBe("sent");
    expect((await q("select 1 from payments where invoice_id=$1", [id])).length).toBe(2); // history stays
    expect((await q("select 1 from payments where invoice_id=$1 and voided_at is not null", [id])).length).toBe(2);
    await pay(user(OWNER), id, "100.00");
    expect((await inv(id)).status).toBe("paid");
  });

  it("the payment currency is the invoice currency; workspace id must match", async () => {
    const id = await createInvoice(user(OWNER), { currency: "CHF", items: [line("a", 1, "10.00")] });
    await pay(user(OWNER), id, "5.00");
    expect((await q<{ currency: string }>("select currency from payments where invoice_id=$1", [id]))[0].currency).toBe("CHF");
    expect(await messageOf(q("insert into payments (workspace_id, invoice_id, amount) values ($1,$2,1)", [wsB, id]))).toMatch(/cross_workspace_reference/);
  });

  it("editing lines of a partly paid invoice may not drop the total below what was paid", async () => {
    const id = await createInvoice(user(OWNER), { items: [line("a", 1, "100.00")] });
    await pay(user(OWNER), id, "60.00");
    expect(await messageOf(run(user(OWNER), "select public.replace_invoice_items($1,$2)", [id, JSON.stringify([line("a", 1, "50.00")])]))).toMatch(/amount_below_paid/);
    expect((await inv(id)).amount).toBe("100.00");
    await run(user(OWNER), "select public.replace_invoice_items($1,$2)", [id, JSON.stringify([line("a", 1, "60.00")])]);
    expect((await inv(id)).status).toBe("paid"); // total == paid
  });

  it("the status can never contradict the payments", async () => {
    const id = await createInvoice(user(OWNER), { items: [line("a", 1, "10.00")] });
    expect(await messageOf(q("update invoices set status='paid' where id=$1", [id]))).toMatch(/status_payment_mismatch/);
    expect(await messageOf(q("update invoices set status='partially_paid' where id=$1", [id]))).toMatch(/status_payment_mismatch/);
    await pay(user(OWNER), id, "4.00");
    expect(await messageOf(q("update invoices set status='sent' where id=$1", [id]))).toMatch(/status_payment_mismatch/);
    expect(await messageOf(q("update invoices set status='void' where id=$1", [id]))).toMatch(/invoice_has_payments/);
  });

  it("draft can be issued once; an issued invoice cannot go back to draft", async () => {
    const id = await createInvoice(user(OWNER), { status: "draft" });
    expect((await inv(id)).status).toBe("draft");
    await run(user(OWNER), "update invoices set status='sent' where id=$1", [id]);
    expect(await messageOf(run(user(OWNER), "update invoices set status='draft' where id=$1", [id]))).toMatch(/invoice_already_issued/);
    expect(await codeOf(createInvoice(user(OWNER), { status: "paid" }))).toBe("22023");
  });

  it("cancel (void) is final: no payments, no edits, no items; refused while payments exist", async () => {
    const withPay = await createInvoice(user(OWNER));
    await pay(user(OWNER), withPay, "1.00");
    expect(await messageOf(run(user(OWNER), "select public.cancel_invoice($1)", [withPay]))).toMatch(/invoice_has_payments/);

    const id = await createInvoice(user(OWNER));
    await run(user(OWNER), "select public.cancel_invoice($1)", [id]);
    expect((await inv(id)).status).toBe("void");
    expect(await messageOf(pay(user(OWNER), id, "1.00"))).toMatch(/invoice_cancelled/);
    expect(await messageOf(run(user(OWNER), "update invoices set notes='x' where id=$1", [id]))).toMatch(/invoice_cancelled/);
    expect(await messageOf(run(user(OWNER), "select public.replace_invoice_items($1,$2)", [id, JSON.stringify([line("z", 1, "1.00")])]))).toMatch(/invoice_locked/);
    expect(await messageOf(run(user(OWNER), "update invoices set status='sent' where id=$1", [id]))).toMatch(/invoice_cancelled/);
  });

  it("payments are immutable except for voiding (once)", async () => {
    const id = await createInvoice(user(OWNER), { items: [line("a", 1, "10.00")] });
    await pay(user(OWNER), id, "10.00");
    expect(await messageOf(run(user(OWNER), "update payments set amount = 1 where invoice_id=$1", [id]))).toMatch(/payment_immutable/);
    await run(user(OWNER), "update payments set voided_at = now() where invoice_id=$1", [id]);
    expect(await messageOf(run(user(OWNER), "update payments set voided_at = null where invoice_id=$1", [id]))).toMatch(/payment_immutable/);
  });

  it("overdue is DERIVED at read time: sent/partial + due date before today; paid and cancelled never", async () => {
    const e = async (s: string, due: string | null, today: string) =>
      (await q<{ s: string }>("select public.invoice_effective_status($1::public.invoice_status, $2::date, $3::date)::text s", [s, due, today]))[0].s;
    expect(await e("sent", "2026-10-01", "2026-10-02")).toBe("overdue");
    expect(await e("partially_paid", "2026-10-01", "2026-10-02")).toBe("overdue");
    expect(await e("sent", "2026-10-02", "2026-10-02")).toBe("sent"); // due today is not overdue yet
    expect(await e("sent", null, "2026-10-02")).toBe("sent");
    expect(await e("paid", "2026-10-01", "2026-10-02")).toBe("paid");
    expect(await e("void", "2026-10-01", "2026-10-02")).toBe("void");
    expect(await e("draft", "2026-10-01", "2026-10-02")).toBe("draft");
  });

  it("totals stay consistent for every invoice created so far", async () => {
    await assertTotalsConsistent();
  });
});

describe("privacy: MAIN / PRIVATE bucket and visibility per role", () => {
  const ids: Record<string, string> = {};
  const idsOf = async (actor: Actor) => new Set((await run<{ id: string }>(actor, "select id from invoices where workspace_id=$1", [wsA])).map((r) => r.id));
  const nameOf = (set: Set<string>) => Object.entries(ids).filter(([, id]) => set.has(id)).map(([k]) => k).sort();

  beforeAll(async () => {
    const o = user(OWNER);
    const items = [line("x", 1, "10.00")];
    ids.main = await createInvoice(o, { items });
    ids.privateBucket = await createInvoice(o, { items, bucketKind: "private" });
    ids.privateVisibility = await createInvoice(o, { items, visibility: "private" });
    ids.ownerOnly = await createInvoice(o, { items, visibility: "owner_only" });
    ids.customBucket = await createInvoice(o, { items, bucketKind: "custom", bucketId: customA });
    ids.customVisibility = await createInvoice(o, { items, visibility: "custom" });
    for (const id of Object.values(ids)) await pay(o, id, "1.00");
  });

  it("owner sees everything", async () => {
    expect(nameOf(await idsOf(user(OWNER)))).toEqual(Object.keys(ids).sort());
  });

  it("admin (no private bucket / private records) sees only main + custom-bucket normal invoices", async () => {
    expect(nameOf(await idsOf(user(ADMIN)))).toEqual(["customBucket", "main"]);
  });

  it("accountant sees the PRIVATE bucket (normal visibility) but not private/owner-only/custom visibility", async () => {
    expect(nameOf(await idsOf(user(ACCOUNTANT)))).toEqual(["customBucket", "main", "privateBucket"]);
  });

  it("manager and staff (no finance.view) see no invoice, item or payment at all", async () => {
    for (const id of [MANAGER, STAFF]) {
      expect((await idsOf(user(id))).size).toBe(0);
      expect((await run(user(id), "select 1 from invoice_items it join invoices i on i.id=it.invoice_id where i.workspace_id=$1", [wsA])).length).toBe(0);
      expect((await run(user(id), "select 1 from payments where workspace_id=$1", [wsA])).length).toBe(0);
    }
  });

  it("items and payments of an invisible invoice are invisible too (resolved through the parent)", async () => {
    for (const [actor, hidden] of [[ADMIN, ["privateBucket", "privateVisibility", "ownerOnly", "customVisibility"]], [ACCOUNTANT, ["privateVisibility", "ownerOnly", "customVisibility"]]] as const) {
      for (const h of hidden) {
        expect((await run(user(actor), "select 1 from invoice_items where invoice_id=$1", [ids[h]])).length, `${actor} items ${h}`).toBe(0);
        expect((await run(user(actor), "select 1 from payments where invoice_id=$1", [ids[h]])).length, `${actor} payments ${h}`).toBe(0);
      }
    }
    expect((await run(user(ADMIN), "select 1 from invoice_items where invoice_id=$1", [ids.main])).length).toBe(1);
    expect((await run(user(ADMIN), "select 1 from payments where invoice_id=$1", [ids.main])).length).toBe(1);
  });

  it("admin cannot write into the private bucket or with private/owner-only visibility", async () => {
    expect(await codeOf(createInvoice(user(ADMIN), { bucketKind: "private" }))).toBe("42501");
    expect(await codeOf(createInvoice(user(ADMIN), { bucketKind: "custom", bucketId: privA }))).toBe("42501");
    expect(await codeOf(createInvoice(user(ADMIN), { visibility: "private" }))).toBe("42501");
    expect(await codeOf(createInvoice(user(ADMIN), { visibility: "owner_only" }))).toBe("42501");
    // ... and cannot touch the owner's hidden rows
    for (const h of ["privateBucket", "privateVisibility", "ownerOnly"]) {
      expect((await run(user(ADMIN), "update invoices set notes='hacked' where id=$1 returning id", [ids[h]])).length).toBe(0);
      expect(await codeOf(pay(user(ADMIN), ids[h], "1.00"))).toBe("P0002");
    }
    // direct moves of a visible row into a hidden class fail the WITH CHECK
    expect(await codeOf(run(user(ADMIN), "update invoices set financial_bucket_id=$2 where id=$1", [ids.main, privA]))).toBe("42501");
    expect(await codeOf(run(user(ADMIN), "update invoices set visibility='owner_only' where id=$1", [ids.main]))).toBe("42501");
  });

  it("accountant (finance.view only) cannot create, edit or pay anything", async () => {
    expect(await codeOf(createInvoice(user(ACCOUNTANT)))).toBe("42501");
    expect((await run(user(ACCOUNTANT), "update invoices set notes='x' where id=$1 returning id", [ids.main])).length).toBe(0);
    expect(await codeOf(pay(user(ACCOUNTANT), ids.main, "1.00"))).toBe("42501");
  });

  it("admin can create and edit main invoices (finance.edit + main bucket)", async () => {
    const id = await createInvoice(user(ADMIN));
    expect((await run(user(ADMIN), "update invoices set notes='ok' where id=$1 returning id", [id])).length).toBe(1);
  });

  it("owner_only and custom visibility survive plain edits of other fields", async () => {
    await run(user(OWNER), "update invoices set notes='edited', due_at=current_date + 30 where id=$1", [ids.ownerOnly]);
    await run(user(OWNER), "update invoices set notes='edited' where id=$1", [ids.customVisibility]);
    await run(user(OWNER), "update invoices set notes='edited' where id=$1", [ids.customBucket]);
    expect((await inv(ids.ownerOnly)).visibility).toBe("owner_only");
    expect((await inv(ids.customVisibility)).visibility).toBe("custom");
    expect((await inv(ids.customBucket)).financial_bucket_id).toBe(customA);
  });
});

describe("cross-workspace references", () => {
  it("create_invoice refuses a client / appointment / bucket of another workspace", async () => {
    expect(await messageOf(createInvoice(user(OWNER), { client: clientB }))).toMatch(/client_not_found/);
    expect(await messageOf(createInvoice(user(OWNER), { appointment: apptB }))).toMatch(/appointment_not_found/);
    expect(await codeOf(createInvoice(user(OWNER), { bucketKind: "custom", bucketId: customB }))).toBe("P0002");
  });

  it("the guard trigger also refuses direct inserts and updates (service role, RLS bypassed)", async () => {
    expect(await messageOf(q("insert into invoices (workspace_id, number, client_id) values ($1,'X-1',$2)", [wsA, clientB]))).toMatch(/cross_workspace_reference/);
    expect(await messageOf(q("insert into invoices (workspace_id, number, appointment_id) values ($1,'X-2',$2)", [wsA, apptB]))).toMatch(/cross_workspace_reference/);
    expect(await messageOf(q("insert into invoices (workspace_id, number, financial_bucket_id) values ($1,'X-3',$2)", [wsA, customB]))).toMatch(/cross_workspace_reference/);
    const id = await createInvoice(user(OWNER), { client: clientA, appointment: apptA });
    expect(await messageOf(q("update invoices set client_id=$2 where id=$1", [id, clientB]))).toMatch(/cross_workspace_reference/);
    expect(await messageOf(q("update invoices set financial_bucket_id=$2 where id=$1", [id, customB]))).toMatch(/cross_workspace_reference/);
    expect((await inv(id)).amount).toBeDefined();
  });

  it("a same-workspace client / appointment is stored with the client's name as a snapshot", async () => {
    const id = await createInvoice(user(OWNER), { client: clientA, appointment: apptA });
    const row = (await q<{ client_id: string; client_name: string; appointment_id: string }>("select client_id, client_name, appointment_id from invoices where id=$1", [id]))[0];
    expect(row).toEqual({ client_id: clientA, client_name: "Anna A", appointment_id: apptA });
  });
});

describe("tenant isolation and anon", () => {
  let idA: string;
  beforeAll(async () => {
    idA = await createInvoice(user(OWNER), { items: [line("secret", 1, "77.00")] });
    await pay(user(OWNER), idA, "7.00");
  });

  it("workspace B cannot read or modify A's invoices, items or payments", async () => {
    expect((await run(user(OWNER_B), "select 1 from invoices where id=$1", [idA])).length).toBe(0);
    expect((await run(user(OWNER_B), "select 1 from invoice_items where invoice_id=$1", [idA])).length).toBe(0);
    expect((await run(user(OWNER_B), "select 1 from payments where invoice_id=$1", [idA])).length).toBe(0);
    expect((await run(user(OWNER_B), "update invoices set notes='x' where id=$1 returning id", [idA])).length).toBe(0);
    expect((await run(user(OWNER_B), "delete from invoice_items where invoice_id=$1 returning id", [idA])).length).toBe(0);
    expect(await codeOf(pay(user(OWNER_B), idA, "1.00"))).toBe("P0002");
    expect(await codeOf(run(user(OWNER_B), "select public.replace_invoice_items($1,'[]')", [idA]))).toBe("P0002");
    expect(await codeOf(run(user(OWNER_B), "select public.cancel_invoice($1)", [idA]))).toBe("P0002");
    expect(await codeOf(createInvoice(user(OWNER_B), { ws: wsA }))).toBe("P0002");
    expect(await codeOf(run(user(OWNER_B), "select public.void_invoice_payments($1)", [idA]))).toBe("P0002");
    expect(Number((await inv(idA)).amount)).toBe(77);
  });

  it("a forged workspace_id on a direct insert does not get past RLS", async () => {
    expect(await codeOf(run(user(OWNER_B), "insert into invoices (workspace_id, number) values ($1,'EVIL-1')", [wsA]))).toBe("42501");
    expect(await codeOf(run(user(OWNER_B), "insert into payments (workspace_id, invoice_id, amount) values ($1,$2,1)", [wsA, idA]))).toBe("42501");
    expect(await codeOf(run(user(OWNER_B), "insert into invoice_items (invoice_id, description) values ($1,'evil')", [idA]))).toBe("42501");
  });

  it("anon can read and write nothing, and call nothing", async () => {
    for (const t of ["invoices", "invoice_items", "payments", "invoice_counters"]) {
      expect(await codeOf(run(anon, `select 1 from ${t}`))).toBe("42501");
    }
    expect(await codeOf(run(anon, "insert into invoices (workspace_id, number) values ($1,'ANON')", [wsA]))).toBe("42501");
    expect(await codeOf(run(anon, "select public.create_invoice($1)", [wsA]))).toBe("42501");
    expect(await codeOf(run(anon, "select public.record_payment($1, 1)", [idA]))).toBe("42501");
  });

  it("the counter table is not reachable by signed-in users", async () => {
    expect(await codeOf(run(user(OWNER), "select 1 from invoice_counters"))).toBe("42501");
    expect(await codeOf(run(user(OWNER), "update invoice_counters set last_value = 0"))).toBe("42501");
  });
});

describe("history is never deleted", () => {
  it("members cannot delete invoices or payments; even the service role is refused by the trigger", async () => {
    const id = await createInvoice(user(OWNER), { items: [line("a", 1, "5.00")] });
    await pay(user(OWNER), id, "5.00");
    expect(await codeOf(run(user(OWNER), "delete from invoices where id=$1", [id]))).toBe("42501");
    expect(await codeOf(run(user(OWNER), "delete from payments where invoice_id=$1", [id]))).toBe("42501");
    expect(await messageOf(q("delete from invoices where id=$1", [id]))).toMatch(/restrict_delete/);
    expect(await messageOf(q("delete from payments where invoice_id=$1", [id]))).toMatch(/restrict_delete/);
    expect((await q("select 1 from invoices where id=$1", [id])).length).toBe(1);
    expect((await q("select 1 from payments where invoice_id=$1", [id])).length).toBe(1);
  });

  it("deleting a whole workspace still cascades (the guard lets a workspace delete through)", async () => {
    const wsC = (await run<{ out_workspace_id: string }>(svc, "select * from public.provision_workspace($1,$2,'','Biz C','fin-c','en')", [OWNER_C, "c@t.invalid"]))[0].out_workspace_id;
    const id = await createInvoice(user(OWNER_C), { ws: wsC });
    await pay(user(OWNER_C), id, "1.00");
    await q("delete from workspaces where id=$1", [wsC]);
    expect((await q("select 1 from invoices where workspace_id=$1", [wsC])).length).toBe(0);
    expect((await q("select 1 from payments where workspace_id=$1", [wsC])).length).toBe(0);
  });

  it("final invariant: amount == sum of lines for every invoice in the database", async () => {
    await assertTotalsConsistent();
  });
});
