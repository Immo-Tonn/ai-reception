import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FinancialBucket } from "@/features/appointments/types";
import type { Invoice, InvoicesRepository } from "@/features/finance/types";
import { statusToDb } from "@/features/finance/status";
import { minorToDecimalString, toMinor, toQuantityMilli } from "@/lib/money";
import { resolveToday } from "@/lib/time/zonedTime";
import { isUuid, visibilityToDb } from "./appointmentsMapper";
import {
  RepositoryConflictError,
  RepositoryError,
  RepositoryNotFoundError,
  toRepositoryError,
  type DbErrorLike,
} from "./errors";
import {
  groupBy,
  invoiceFromRow,
  type InvoiceItemRow,
  type InvoiceLookups,
  type InvoiceRow,
  type PaymentRow,
} from "./invoicesMapper";

export type { InvoicesRepository };

const BUSINESS_RULE = /overpayment|invoice_cancelled|invoice_locked|amount_below_paid|status_payment_mismatch|invoice_has_payments|invoice_already_issued|payment_immutable|payment_invalid|invoice_identity_immutable|restrict_delete/;
const NOT_FOUND = /client_not_found|appointment_not_found|bucket_not_found|^not_found/;

/** Business-rule refusals (overpayment, locked invoice ...) are conflicts; missing references are not-found. */
export function toInvoiceError(error: DbErrorLike | null | undefined, context: string): RepositoryError {
  const message = error?.message ?? "";
  if (BUSINESS_RULE.test(message)) return new RepositoryConflictError(context);
  if (NOT_FOUND.test(message)) return new RepositoryNotFoundError(context);
  return toRepositoryError(error, context);
}

function itemsPayload(items: NonNullable<Invoice["items"]>) {
  return items.map((i) => ({
    description: i.description,
    // decimal TEXT, so nothing travels as a float
    quantity: (toQuantityMilli(i.quantity) / 1000).toFixed(3),
    unit_price: minorToDecimalString(toMinor(i.unitPrice)),
  }));
}

export function createSupabaseInvoicesRepository(
  workspaceId: string,
  getClient: () => Promise<SupabaseClient> = createSupabaseServerClient,
  now: () => Date = () => new Date(),
): InvoicesRepository {
  async function lookups(client: SupabaseClient, scope: { ids?: string[] } = {}): Promise<InvoiceLookups> {
    const [zone, buckets, items, payments] = await Promise.all([
      client.from("workspaces").select("timezone").eq("id", workspaceId).maybeSingle(),
      client.rpc("workspace_financial_bucket_kinds", { p_workspace_id: workspaceId }),
      client.rpc("list_invoice_items", { p_workspace_id: workspaceId }),
      client.from("payments").select("*").eq("workspace_id", workspaceId).order("paid_at", { ascending: true }),
    ]);
    if (items.error) throw toInvoiceError(items.error, "invoices.items");
    if (payments.error) throw toInvoiceError(payments.error, "invoices.payments");
    const tz = (zone.data as { timezone?: string } | null)?.timezone ?? null;
    const ids = scope.ids ? new Set(scope.ids) : null;
    const keep = <T extends { invoice_id: string }>(rows: T[]) => (ids ? rows.filter((r) => ids.has(r.invoice_id)) : rows);
    return {
      bucketKinds: new Map(((buckets.data as { id: string; kind: string }[]) ?? []).map((b) => [b.id, b.kind as FinancialBucket])),
      itemsByInvoice: groupBy(keep((items.data as InvoiceItemRow[]) ?? []), (r) => r.invoice_id),
      paymentsByInvoice: groupBy(keep((payments.data as PaymentRow[]) ?? []), (r) => r.invoice_id),
      today: resolveToday(now(), tz),
    };
  }

  async function bucketIdFor(client: SupabaseClient, kind: FinancialBucket, bucketId?: string | null): Promise<string> {
    const { data, error } = await client.rpc("resolve_financial_bucket", {
      p_workspace_id: workspaceId,
      p_kind: kind,
      p_bucket_id: isUuid(bucketId) ? bucketId : null,
    });
    if (error || !data) throw toInvoiceError(error ?? { code: "P0002" }, "invoices.bucket");
    return data as string;
  }

  async function load(client: SupabaseClient, id: string): Promise<Invoice | undefined> {
    if (!isUuid(id)) return undefined;
    const { data, error } = await client.from("invoices").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
    if (error) throw toInvoiceError(error, "invoices.get");
    if (!data) return undefined;
    return invoiceFromRow(data as InvoiceRow, await lookups(client, { ids: [id] }));
  }

  return {
    async list() {
      const client = await getClient();
      const { data, error } = await client
        .from("invoices")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("issued_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw toInvoiceError(error, "invoices.list");
      const rows = (data as InvoiceRow[]) ?? [];
      if (rows.length === 0) return [];
      const l = await lookups(client);
      return rows.map((r) => invoiceFromRow(r, l));
    },

    async get(id) {
      return load(await getClient(), id);
    },

    async create(item) {
      const client = await getClient();
      const { data, error } = await client.rpc("create_invoice", {
        p_workspace_id: workspaceId,
        p_client_id: isUuid(item.clientId) ? item.clientId : null,
        p_client_name: item.client,
        p_appointment_id: isUuid(item.appointmentId) ? item.appointmentId : null,
        p_bucket_kind: item.bucket,
        p_bucket_id: isUuid(item.financialBucketId) ? item.financialBucketId : null,
        p_visibility: visibilityToDb(item.visibility),
        p_status: statusToDb(item.status) === "draft" ? "draft" : "sent",
        p_currency: item.currency || null,
        p_issued_at: item.date || null,
        p_due_at: item.dueDate || null,
        p_notes: item.notes ?? "",
        p_items: itemsPayload(item.items ?? []),
      });
      if (error || !data) throw toInvoiceError(error ?? { code: "" }, "invoices.create");
      const created = await load(client, data as string);
      if (!created) throw new RepositoryNotFoundError("invoices.create");
      return created;
    },

    async update(id, patch) {
      if (!isUuid(id)) return undefined;
      const client = await getClient();
      const existing = await load(client, id);
      if (!existing) return undefined;

      // Items first: the likeliest refusals (locked / paid invoice, total below paid) happen before anything else changes.
      if (patch.items !== undefined) {
        const { error } = await client.rpc("replace_invoice_items", { p_invoice_id: id, p_items: itemsPayload(patch.items) });
        if (error) throw toInvoiceError(error, "invoices.items");
      }

      const row: Record<string, unknown> = {};
      if (patch.clientId !== undefined || patch.client !== undefined) {
        if (isUuid(patch.clientId)) {
          const { data, error } = await client.from("clients").select("name").eq("workspace_id", workspaceId).eq("id", patch.clientId).maybeSingle();
          if (error) throw toInvoiceError(error, "invoices.client");
          if (!data) throw new RepositoryNotFoundError("invoices.client");
          row.client_id = patch.clientId;
          row.client_name = (data as { name: string }).name;
        } else {
          if (patch.clientId === null) row.client_id = null;
          if (patch.client !== undefined) row.client_name = patch.client;
        }
      }
      if (patch.visibility !== undefined) row.visibility = visibilityToDb(patch.visibility);
      if (patch.notes !== undefined) row.notes = patch.notes;
      if (patch.dueDate !== undefined) row.due_at = patch.dueDate || null;
      if (patch.bucket !== undefined || patch.financialBucketId !== undefined) {
        const kind = patch.bucket ?? existing.bucket;
        const explicit = isUuid(patch.financialBucketId) ? patch.financialBucketId : null;
        // Same class and no explicit id: keep the CURRENT bucket (a custom bucket id is preserved on edit).
        if (explicit || kind !== existing.bucket) row.financial_bucket_id = await bucketIdFor(client, kind, explicit);
      }
      if (patch.status === "unpaid" && existing.status === "draft") row.status = "sent";

      if (Object.keys(row).length > 0) {
        const { error } = await client.from("invoices").update(row).eq("workspace_id", workspaceId).eq("id", id);
        if (error) throw toInvoiceError(error, "invoices.update");
      }
      if (patch.status === "cancelled") {
        const { error } = await client.rpc("cancel_invoice", { p_invoice_id: id });
        if (error) throw toInvoiceError(error, "invoices.cancel");
      }
      return load(client, id);
    },

    async recordPayment(id, payment) {
      if (!isUuid(id)) return undefined;
      const client = await getClient();
      const { error } = await client.rpc("record_payment", {
        p_invoice_id: id,
        p_amount: minorToDecimalString(toMinor(payment.amount)),
        p_method: payment.method,
        p_paid_at: payment.paidAt ?? null,
      });
      if (error) throw toInvoiceError(error, "invoices.payment");
      return load(client, id);
    },

    async voidPayments(id) {
      if (!isUuid(id)) return undefined;
      const client = await getClient();
      const { error } = await client.rpc("void_invoice_payments", { p_invoice_id: id });
      if (error) throw toInvoiceError(error, "invoices.voidPayments");
      return load(client, id);
    },

    async cancel(id) {
      if (!isUuid(id)) return undefined;
      const client = await getClient();
      const { error } = await client.rpc("cancel_invoice", { p_invoice_id: id });
      if (error) throw toInvoiceError(error, "invoices.cancel");
      return load(client, id);
    },

    async remove() {
      throw new RepositoryError("invoices cannot be deleted; cancel the invoice instead");
    },

    async replaceAll() {
      throw new RepositoryError("invoices.replaceAll is not supported");
    },
  };
}
