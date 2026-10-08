import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { as, type Actor } from "./pg";

/**
 * Test double for `SupabaseClient` that executes the supabase-js calls our
 * repositories make against a REAL PostgreSQL (PGlite), as a given actor
 * (anon / a signed-in user / service role) — so Row Level Security, triggers,
 * constraints and RPC functions all run for real. Supports only the subset of
 * the query builder the repositories use: from().select/insert/update/delete
 * with eq/neq/in/gt/gte/lt/lte/is, order, limit, single/maybeSingle, plus rpc()
 * and auth.getUser(). Results mimic PostgREST: timestamps as ISO strings,
 * scalar rpc results unwrapped, errors as { message, code }.
 */

type Filter = { col: string; op: string; val: unknown };
type PgError = { message: string; code?: string };

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (name: string) => {
  if (!IDENT.test(name)) throw new Error(`unsupported identifier in test client: ${name}`);
  return `"${name}"`;
};

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  return value;
}
const normalizeRow = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, normalizeValue(v)]));

class Query implements PromiseLike<{ data: unknown; error: PgError | null }> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private cols = "*";
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private limitN: number | null = null;
  private mode: "many" | "single" | "maybe" = "many";
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private returning = false;

  constructor(
    private db: PGlite,
    private actor: Actor,
    private table: string,
  ) {}

  select(cols = "*") {
    if (this.op === "select") this.cols = cols;
    else {
      this.returning = true;
      this.cols = cols;
    }
    return this;
  }
  insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Record<string, unknown>) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, val: unknown) { return this.f(col, "=", val); }
  neq(col: string, val: unknown) { return this.f(col, "<>", val); }
  gt(col: string, val: unknown) { return this.f(col, ">", val); }
  gte(col: string, val: unknown) { return this.f(col, ">=", val); }
  lt(col: string, val: unknown) { return this.f(col, "<", val); }
  lte(col: string, val: unknown) { return this.f(col, "<=", val); }
  is(col: string, val: unknown) { return this.f(col, val === null ? "is null" : "is", val); }
  in(col: string, vals: unknown[]) { return this.f(col, "in", vals); }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }
  private f(col: string, op: string, val: unknown) {
    this.filters.push({ col, op, val });
    return this;
  }

  then<R1 = { data: unknown; error: PgError | null }, R2 = never>(
    onfulfilled?: ((value: { data: unknown; error: PgError | null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private where(params: unknown[]): string {
    if (this.filters.length === 0) return "";
    const parts = this.filters.map(({ col, op, val }) => {
      if (op === "is null") return `${ident(col)} is null`;
      if (op === "in") {
        const list = val as unknown[];
        if (list.length === 0) return "false";
        return `${ident(col)} in (${list.map((v) => (params.push(v), `$${params.length}`)).join(", ")})`;
      }
      params.push(val);
      return `${ident(col)} ${op} $${params.length}`;
    });
    return ` where ${parts.join(" and ")}`;
  }

  private async run(): Promise<{ data: unknown; error: PgError | null }> {
    const params: unknown[] = [];
    const t = `public.${ident(this.table)}`;
    const cols = this.cols === "*" ? "*" : this.cols.split(",").map((c) => ident(c.trim())).join(", ");
    let sql: string;

    if (this.op === "select") {
      sql = `select ${cols} from ${t}${this.where(params)}`;
      if (this.orders.length) sql += ` order by ${this.orders.map((o) => `${ident(o.col)} ${o.asc ? "asc" : "desc"}`).join(", ")}`;
      if (this.limitN !== null) sql += ` limit ${Number(this.limitN)}`;
    } else if (this.op === "insert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload!];
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const values = rows.map(
        (r) => `(${keys.map((k) => (params.push(k in r ? normalizeJsonParam(r[k]) : null), `$${params.length}`)).join(", ")})`,
      );
      sql = `insert into ${t} (${keys.map(ident).join(", ")}) values ${values.join(", ")}`;
      if (this.returning || this.mode !== "many") sql += ` returning ${cols}`;
    } else if (this.op === "update") {
      const entries = Object.entries(this.payload as Record<string, unknown>);
      const sets = entries.map(([k, v]) => (params.push(normalizeJsonParam(v)), `${ident(k)} = $${params.length}`));
      sql = `update ${t} set ${sets.join(", ")}${this.where(params)}`;
      if (this.returning || this.mode !== "many") sql += ` returning ${cols}`;
    } else {
      sql = `delete from ${t}${this.where(params)}`;
    }

    try {
      const result = await as(this.db, this.actor, () => this.db.query<Record<string, unknown>>(sql, params));
      const rows = (result.rows ?? []).map(normalizeRow);
      if (this.mode === "many") return { data: rows, error: null };
      if (rows.length === 1) return { data: rows[0], error: null };
      if (rows.length === 0) {
        return this.mode === "maybe" ? { data: null, error: null } : { data: null, error: { message: "no rows", code: "PGRST116" } };
      }
      return { data: null, error: { message: "multiple rows", code: "PGRST116" } };
    } catch (e) {
      const err = e as { message?: string; code?: string };
      return { data: null, error: { message: err.message ?? "error", code: err.code } };
    }
  }
}

function normalizeJsonParam(value: unknown): unknown {
  // arrays of plain values (text[]) go as arrays; objects as JSON
  if (value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) return JSON.stringify(value);
  return value;
}

export function createPgliteSupabaseClient(db: PGlite, actor: Actor): SupabaseClient {
  const client = {
    from: (table: string) => new Query(db, actor, table),

    async rpc(name: string, args: Record<string, unknown> = {}) {
      const keys = Object.keys(args);
      const params = keys.map((k) => {
        const v = args[k];
        return v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v;
      });
      const call = `select * from public.${ident(name)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")})`;
      try {
        const result = await as(db, actor, () => db.query<Record<string, unknown>>(call, params));
        const rows = result.rows.map(normalizeRow);
        const scalar = result.fields.length === 1 && result.fields[0].name === name;
        return { data: scalar ? (rows[0]?.[name] ?? null) : rows, error: null };
      } catch (e) {
        const err = e as { message?: string; code?: string };
        return { data: null, error: { message: err.message ?? "error", code: err.code } };
      }
    },

    auth: {
      async getUser() {
        return actor.kind === "user"
          ? { data: { user: { id: actor.id } }, error: null }
          : { data: { user: null }, error: { message: "no session" } };
      },
    },
  };
  return client as unknown as SupabaseClient;
}
