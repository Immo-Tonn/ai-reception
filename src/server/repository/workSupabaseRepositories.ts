import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Repository } from "@/lib/repository/types";
import type { FinancialBucket } from "@/features/appointments/types";
import type { Job, Lead, Project, Quote, QuoteItem } from "@/features/work/types";
import { BusinessRuleError } from "@/server/services/businessRuleError";
import { isUuid, visibilityFromDb, visibilityToDb } from "./appointmentsMapper";
import { RepositoryError, toRepositoryError, type DbErrorLike } from "./errors";

/**
 * Supabase adapters for the Work pipeline (leads, quotes, jobs, projects) — migration 0021.
 * They run as the signed-in user (RLS decides what is visible / writable). "remove" ARCHIVES (work is history).
 * Visibility and the financial bucket are two independent columns; an update only writes the ones the patch
 * names, so owner_only / custom visibility and custom buckets survive edits made by the simple UI.
 */
type ClientFactory = () => Promise<SupabaseClient>;

/** 22023 = a business rule of a conversion / transition (lost lead, declined quote, ...). */
export function toWorkError(error: DbErrorLike | null | undefined, context: string): RepositoryError | BusinessRuleError {
  if (error?.code === "22023") return new BusinessRuleError(error.message ?? "invalid_work_transition", "invalid_work_transition");
  return toRepositoryError(error, context);
}

const num = (v: unknown): number => Number(v ?? 0);
const dateOnly = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);

interface BaseRow {
  id: string;
  client_id: string | null;
  client_name: string;
  title: string;
  notes: string;
  visibility: string;
  financial_bucket_id: string | null;
  archived: boolean;
  created_at: string;
}
interface LeadRow extends BaseRow {
  stage: string;
  source: string;
  estimated_value: number | string | null;
  currency: string;
}
interface QuoteRow extends BaseRow {
  lead_id: string | null;
  status: string;
  amount: number | string;
  currency: string;
  valid_until: string | null;
}
interface QuoteItemRow {
  id: string;
  quote_id: string;
  position: number;
  description: string;
  quantity: number | string;
  unit_price: number | string;
}
interface JobRow extends BaseRow {
  quote_id: string | null;
  project_id: string | null;
  status: string;
  amount: number | string;
  currency: string;
  responsible_staff_id: string | null;
  starts_on: string | null;
  due_on: string | null;
}
interface ProjectRow extends BaseRow {
  status: string;
  starts_on: string | null;
  ends_on: string | null;
}

interface Lookups {
  clients: Map<string, string>;
  bucketKinds: Map<string, FinancialBucket>;
}

function baseFields(row: BaseRow, lk: Lookups) {
  const bucketKnown = row.financial_bucket_id ? lk.bucketKinds.get(row.financial_bucket_id) : undefined;
  return {
    id: row.id,
    clientName: row.client_id ? (lk.clients.get(row.client_id) ?? row.client_name) : row.client_name,
    clientId: row.client_id,
    title: row.title,
    notes: row.notes,
    visibility: visibilityFromDb(row.visibility),
    financialBucket: bucketKnown ?? ("main" as FinancialBucket),
    ...(row.financial_bucket_id && bucketKnown ? { financialBucketId: row.financial_bucket_id } : {}),
    createdAt: String(row.created_at).slice(0, 10),
    archived: row.archived,
  };
}

interface Entity<T extends { id: string }, R extends BaseRow, X> {
  table: "leads" | "quotes" | "jobs" | "projects";
  ctx: string;
  extra: (client: SupabaseClient, workspaceId: string, rows: R[]) => Promise<X>;
  fromRow: (row: R, lk: Lookups, extra: X) => T;
  insertRow: (item: T) => Record<string, unknown>;
  patchRow: (patch: Partial<T>) => Record<string, unknown>;
  /** Runs after insert / update for things that are not plain columns (quote items). */
  after?: (client: SupabaseClient, id: string, source: Partial<T>) => Promise<void>;
}

function createWorkRepository<T extends { id: string } & Pick<Lead, "clientName" | "clientId" | "title" | "notes" | "visibility" | "financialBucket" | "financialBucketId">, R extends BaseRow, X>(
  workspaceId: string,
  getClient: ClientFactory,
  e: Entity<T, R, X>,
): Repository<T> {
  async function lookups(client: SupabaseClient): Promise<Lookups> {
    const [clients, buckets] = await Promise.all([
      client.from("clients").select("id,name").eq("workspace_id", workspaceId),
      client.rpc("workspace_financial_bucket_kinds", { p_workspace_id: workspaceId }),
    ]);
    return {
      clients: new Map(((clients.data as { id: string; name: string }[]) ?? []).map((c) => [c.id, c.name])),
      bucketKinds: new Map(((buckets.data as { id: string; kind: string }[]) ?? []).map((b) => [b.id, b.kind as FinancialBucket])),
    };
  }

  async function resolveBucket(client: SupabaseClient, kind: FinancialBucket, bucketId?: string): Promise<string> {
    const { data, error } = await client.rpc("resolve_financial_bucket", {
      p_workspace_id: workspaceId,
      p_kind: kind,
      p_bucket_id: isUuid(bucketId) ? bucketId : null,
    });
    if (error || !data) throw toRepositoryError(error ?? { code: "P0002" }, `${e.ctx}.bucket`);
    return data as string;
  }

  /** Columns shared by all four entities; only the ones named in `src` are produced. */
  async function commonColumns(client: SupabaseClient, src: Partial<T>): Promise<Record<string, unknown>> {
    const row: Record<string, unknown> = {};
    if (src.title !== undefined) row.title = src.title;
    if (src.notes !== undefined) row.notes = src.notes;
    if (src.visibility !== undefined) row.visibility = visibilityToDb(src.visibility);
    if (src.clientId !== undefined) {
      row.client_id = isUuid(src.clientId) ? src.clientId : null;
      if (isUuid(src.clientId)) {
        const { data } = await client.from("clients").select("name").eq("workspace_id", workspaceId).eq("id", src.clientId).maybeSingle();
        row.client_name = (data as { name: string } | null)?.name ?? src.clientName ?? "";
      } else {
        row.client_name = src.clientName ?? "";
      }
    } else if (src.clientName !== undefined) {
      row.client_name = src.clientName;
    }
    if (src.financialBucket !== undefined || src.financialBucketId !== undefined) {
      row.financial_bucket_id = await resolveBucket(client, src.financialBucket ?? "main", src.financialBucketId);
    }
    return row;
  }

  async function read(client: SupabaseClient, id: string): Promise<T | undefined> {
    const [row, lk] = await Promise.all([
      client.from(e.table).select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle(),
      lookups(client),
    ]);
    if (row.error) throw toRepositoryError(row.error, `${e.ctx}.get`);
    if (!row.data) return undefined;
    return e.fromRow(row.data as R, lk, await e.extra(client, workspaceId, [row.data as R]));
  }

  return {
    async list() {
      const client = await getClient();
      const [rows, lk] = await Promise.all([
        client.from(e.table).select("*").eq("workspace_id", workspaceId).eq("archived", false).order("created_at", { ascending: false }),
        lookups(client),
      ]);
      if (rows.error) throw toRepositoryError(rows.error, `${e.ctx}.list`);
      const list = (rows.data as R[]) ?? [];
      const extra = await e.extra(client, workspaceId, list);
      return list.map((r) => e.fromRow(r, lk, extra));
    },

    async get(id) {
      if (!isUuid(id)) return undefined;
      return read(await getClient(), id);
    },

    async create(item) {
      const client = await getClient();
      if (!item.financialBucket) throw new RepositoryError(`${e.ctx}.create`);
      const { data: u } = await client.auth.getUser();
      const common = await commonColumns(client, item);
      if (common.financial_bucket_id === undefined) common.financial_bucket_id = await resolveBucket(client, item.financialBucket);
      const { data, error } = await client
        .from(e.table)
        .insert({
          ...(isUuid(item.id) ? { id: item.id } : {}),
          workspace_id: workspaceId,
          created_by: u.user?.id ?? null,
          ...common,
          ...e.insertRow(item),
        })
        .select("id")
        .single();
      if (error || !data) throw toWorkError(error, `${e.ctx}.create`);
      const id = (data as { id: string }).id;
      if (e.after) await e.after(client, id, item);
      const created = await read(client, id);
      if (!created) throw new RepositoryError(`${e.ctx}.create`);
      return created;
    },

    async update(id, patch) {
      if (!isUuid(id)) return undefined;
      const client = await getClient();
      const row = { ...(await commonColumns(client, patch)), ...e.patchRow(patch) };
      if (Object.keys(row).length > 0) {
        const { data, error } = await client.from(e.table).update(row).eq("workspace_id", workspaceId).eq("id", id).select("id").maybeSingle();
        if (error) throw toWorkError(error, `${e.ctx}.update`);
        if (!data) return undefined;
      }
      if (e.after) await e.after(client, id, patch);
      return read(client, id);
    },

    async remove(id) {
      if (!isUuid(id)) return;
      const client = await getClient();
      const { error } = await client.from(e.table).update({ archived: true }).eq("workspace_id", workspaceId).eq("id", id);
      if (error) throw toRepositoryError(error, `${e.ctx}.archive`);
    },

    async replaceAll() {
      throw new RepositoryError(`${e.ctx}.replaceAll is not supported`);
    },
  };
}

const noExtra = async () => null;

export function createSupabaseLeadsRepository(workspaceId: string, getClient: ClientFactory = createSupabaseServerClient): Repository<Lead> {
  return createWorkRepository<Lead, LeadRow, Map<string, string>>(workspaceId, getClient, {
    table: "leads",
    ctx: "leads",
    extra: async (client) => {
      const { data } = await client.from("quotes").select("id,lead_id").eq("workspace_id", workspaceId);
      const linked = ((data as { id: string; lead_id: string | null }[]) ?? []).filter((q) => q.lead_id);
      return new Map(linked.map((q) => [q.lead_id as string, q.id]));
    },
    fromRow: (r, lk, quoteByLead) => ({
      ...baseFields(r, lk),
      stage: r.stage as Lead["stage"],
      quoteId: quoteByLead.get(r.id) ?? null,
      source: r.source,
      estimatedValue: r.estimated_value == null ? null : num(r.estimated_value),
      currency: r.currency,
    }),
    insertRow: (i) => ({
      stage: i.stage,
      source: i.source ?? "",
      estimated_value: i.estimatedValue ?? null,
      currency: i.currency ?? "EUR",
    }),
    patchRow: (p) => {
      const row: Record<string, unknown> = {};
      if (p.stage !== undefined) row.stage = p.stage;
      if (p.source !== undefined) row.source = p.source;
      if (p.estimatedValue !== undefined) row.estimated_value = p.estimatedValue;
      if (p.currency !== undefined) row.currency = p.currency;
      return row;
    },
  });
}

interface QuoteExtra {
  items: Map<string, QuoteItem[]>;
  jobByQuote: Map<string, string>;
}

export function createSupabaseQuotesRepository(workspaceId: string, getClient: ClientFactory = createSupabaseServerClient): Repository<Quote> {
  return createWorkRepository<Quote, QuoteRow, QuoteExtra>(workspaceId, getClient, {
    table: "quotes",
    ctx: "quotes",
    extra: async (client) => {
      const [items, jobs] = await Promise.all([
        client.from("quote_items").select("id,quote_id,position,description,quantity,unit_price").eq("workspace_id", workspaceId).order("position", { ascending: true }),
        client.from("jobs").select("id,quote_id").eq("workspace_id", workspaceId),
      ]);
      const byQuote = new Map<string, QuoteItem[]>();
      for (const i of (items.data as QuoteItemRow[]) ?? []) {
        const list = byQuote.get(i.quote_id) ?? [];
        list.push({ id: i.id, description: i.description, quantity: num(i.quantity), unitPrice: num(i.unit_price) });
        byQuote.set(i.quote_id, list);
      }
      return { items: byQuote, jobByQuote: new Map(((jobs.data as { id: string; quote_id: string | null }[]) ?? []).filter((j) => j.quote_id).map((j) => [j.quote_id as string, j.id])) };
    },
    fromRow: (r, lk, x) => ({
      ...baseFields(r, lk),
      leadId: r.lead_id,
      amount: num(r.amount),
      currency: r.currency,
      status: r.status as Quote["status"],
      jobId: x.jobByQuote.get(r.id) ?? null,
      validUntil: dateOnly(r.valid_until),
      items: x.items.get(r.id) ?? [],
    }),
    insertRow: (i) => ({
      status: i.status,
      amount: i.amount,
      currency: i.currency,
      valid_until: i.validUntil ?? null,
      lead_id: isUuid(i.leadId) ? i.leadId : null,
    }),
    patchRow: (p) => {
      const row: Record<string, unknown> = {};
      if (p.status !== undefined) row.status = p.status;
      if (p.amount !== undefined) row.amount = p.amount;
      if (p.currency !== undefined) row.currency = p.currency;
      if (p.validUntil !== undefined) row.valid_until = p.validUntil;
      return row;
    },
    after: async (client, id, src) => {
      if (!src.items) return;
      const { error } = await client.rpc("replace_quote_items", {
        p_quote_id: id,
        p_items: src.items.map((i) => ({ description: i.description, quantity: i.quantity, unit_price: i.unitPrice })),
      });
      if (error) throw toWorkError(error, "quotes.items");
    },
  });
}

interface JobExtra {
  invoices: Map<string, { id: string; number: string }>;
}

export function createSupabaseJobsRepository(workspaceId: string, getClient: ClientFactory = createSupabaseServerClient): Repository<Job> {
  return createWorkRepository<Job, JobRow, JobExtra>(workspaceId, getClient, {
    table: "jobs",
    ctx: "jobs",
    extra: async (client) => {
      // The invoice link is a Finance concern: a caller without finance.view simply gets no rows (RLS), not an error.
      const { data, error } = await client.from("invoices").select("id,number,job_id").eq("workspace_id", workspaceId);
      const map = new Map<string, { id: string; number: string }>();
      if (!error) for (const i of (data as { id: string; number: string; job_id: string | null }[]) ?? []) if (i.job_id) map.set(i.job_id, { id: i.id, number: i.number });
      return { invoices: map };
    },
    fromRow: (r, lk, x) => ({
      ...baseFields(r, lk),
      quoteId: r.quote_id,
      amount: num(r.amount),
      currency: r.currency,
      status: r.status as Job["status"],
      invoiceId: x.invoices.get(r.id)?.id ?? null,
      invoiceNumber: x.invoices.get(r.id)?.number ?? null,
      projectId: r.project_id,
      staffId: r.responsible_staff_id,
      startsOn: dateOnly(r.starts_on),
      dueOn: dateOnly(r.due_on),
    }),
    insertRow: (i) => ({
      status: i.status,
      amount: i.amount,
      currency: i.currency,
      quote_id: isUuid(i.quoteId) ? i.quoteId : null,
      project_id: isUuid(i.projectId) ? i.projectId : null,
      responsible_staff_id: isUuid(i.staffId) ? i.staffId : null,
      starts_on: i.startsOn ?? null,
      due_on: i.dueOn ?? null,
    }),
    patchRow: (p) => {
      const row: Record<string, unknown> = {};
      if (p.status !== undefined) row.status = p.status;
      if (p.amount !== undefined) row.amount = p.amount;
      if (p.currency !== undefined) row.currency = p.currency;
      if (p.projectId !== undefined) row.project_id = isUuid(p.projectId) ? p.projectId : null;
      if (p.staffId !== undefined) row.responsible_staff_id = isUuid(p.staffId) ? p.staffId : null;
      if (p.startsOn !== undefined) row.starts_on = p.startsOn;
      if (p.dueOn !== undefined) row.due_on = p.dueOn;
      return row;
    },
  });
}

export function createSupabaseProjectsRepository(workspaceId: string, getClient: ClientFactory = createSupabaseServerClient): Repository<Project> {
  return createWorkRepository<Project, ProjectRow, null>(workspaceId, getClient, {
    table: "projects",
    ctx: "projects",
    extra: noExtra,
    fromRow: (r, lk) => ({
      ...baseFields(r, lk),
      status: r.status as Project["status"],
      startsOn: dateOnly(r.starts_on),
      endsOn: dateOnly(r.ends_on),
    }),
    insertRow: (i) => ({ status: i.status, starts_on: i.startsOn ?? null, ends_on: i.endsOn ?? null }),
    patchRow: (p) => {
      const row: Record<string, unknown> = {};
      if (p.status !== undefined) row.status = p.status;
      if (p.startsOn !== undefined) row.starts_on = p.startsOn;
      if (p.endsOn !== undefined) row.ends_on = p.endsOn;
      return row;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Conversions: ONE database function each (atomic, idempotent, RLS applies). Results are ids only.
// ---------------------------------------------------------------------------------------------
export interface ConversionOverrides {
  visibility?: "normal" | "private" | "ownerOnly" | "custom";
  financialBucketId?: string;
}
export interface WorkOps {
  convertLeadToQuote(leadId: string, overrides?: ConversionOverrides): Promise<{ quoteId: string; created: boolean }>;
  acceptQuoteCreateJob(quoteId: string, projectId?: string | null, overrides?: ConversionOverrides): Promise<{ jobId: string; created: boolean }>;
  createProjectForJob(jobId: string): Promise<{ projectId: string; created: boolean }>;
  attachJobToProject(jobId: string, projectId: string): Promise<void>;
}

export function createSupabaseWorkOps(getClient: ClientFactory = createSupabaseServerClient): WorkOps {
  const overrideArgs = (o?: ConversionOverrides) => ({
    p_visibility: o?.visibility ? visibilityToDb(o.visibility) : null,
    p_financial_bucket_id: isUuid(o?.financialBucketId) ? o?.financialBucketId : null,
  });
  const first = <R>(data: unknown): R => {
    const row = (Array.isArray(data) ? data[0] : data) as R | undefined;
    if (!row) throw new RepositoryError("work.convert");
    return row;
  };
  return {
    async convertLeadToQuote(leadId, overrides) {
      if (!isUuid(leadId)) throw toRepositoryError({ code: "P0002" }, "work.convertLead");
      const { data, error } = await (await getClient()).rpc("convert_lead_to_quote", { p_lead_id: leadId, ...overrideArgs(overrides) });
      if (error) throw toWorkError(error, "work.convertLead");
      const r = first<{ out_quote_id: string; out_created: boolean }>(data);
      return { quoteId: r.out_quote_id, created: r.out_created };
    },
    async acceptQuoteCreateJob(quoteId, projectId, overrides) {
      if (!isUuid(quoteId)) throw toRepositoryError({ code: "P0002" }, "work.acceptQuote");
      const { data, error } = await (await getClient()).rpc("accept_quote_create_job", {
        p_quote_id: quoteId,
        p_project_id: isUuid(projectId) ? projectId : null,
        ...overrideArgs(overrides),
      });
      if (error) throw toWorkError(error, "work.acceptQuote");
      const r = first<{ out_job_id: string; out_created: boolean }>(data);
      return { jobId: r.out_job_id, created: r.out_created };
    },
    async createProjectForJob(jobId) {
      if (!isUuid(jobId)) throw toRepositoryError({ code: "P0002" }, "work.projectForJob");
      const { data, error } = await (await getClient()).rpc("create_project_for_job", { p_job_id: jobId });
      if (error) throw toWorkError(error, "work.projectForJob");
      const r = first<{ out_project_id: string; out_created: boolean }>(data);
      return { projectId: r.out_project_id, created: r.out_created };
    },
    async attachJobToProject(jobId, projectId) {
      if (!isUuid(jobId) || !isUuid(projectId)) throw toRepositoryError({ code: "P0002" }, "work.attach");
      const { error } = await (await getClient()).rpc("attach_job_to_project", { p_job_id: jobId, p_project_id: projectId });
      if (error) throw toWorkError(error, "work.attach");
    },
  };
}
