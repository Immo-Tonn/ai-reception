import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan, can } from "@/server/permissions/roles";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RepositoryNotFoundError, toRepositoryError } from "@/server/repository/errors";
import { toMinor } from "@/lib/money";
import { isValidTimeZone, todayInTimeZone } from "@/lib/time/zonedTime";
import type { ClientRelated, RelatedInvoice, RelatedWorkItem } from "@/features/crossModule/types";

const LIMIT = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;

/**
 * What belongs to one client in the other modules, for the read-only "Related" panel. Everything is read
 * with the USER-SCOPED client, so Row Level Security decides every row: work needs clients.view (+ the row's
 * visibility / bucket rules), invoices need finance.view (+ bucket / visibility). A section the viewer may
 * not read is omitted entirely. Demo workspaces return nothing (their fixtures are local).
 */
export async function getClientRelated(session: Session, clientId: string): Promise<ClientRelated> {
  assertCan(session.role, "clients.view");
  if (isDemoWorkspaceSlug(session.workspaceId) || !UUID.test(clientId)) return {};

  const db = await createSupabaseServerClient();
  const ws = session.workspaceId;

  // The client must belong to this workspace (RLS + explicit filter): a forged id yields not-found.
  const { data: client, error: clientError } = await db
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (clientError) throw toRepositoryError(clientError, "crossModule.client");
  if (!client) throw new RepositoryNotFoundError("crossModule.client");

  const result: ClientRelated = {};

  const fetchWork = async (table: "leads" | "quotes" | "jobs" | "projects", columns: string): Promise<Row[]> => {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .eq("workspace_id", ws)
      .eq("client_id", clientId)
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (error) throw toRepositoryError(error, `crossModule.${table}`);
    return (data ?? []) as unknown as Row[];
  };
  const item = (r: Row, statusKey: string, money: boolean): RelatedWorkItem => ({
    id: String(r.id),
    title: String(r.title ?? ""),
    status: String(r[statusKey] ?? ""),
    ...(money ? { amountMinor: toMinor(String(r.amount ?? "0")), currency: String(r.currency ?? "") } : {}),
  });

  const [leads, quotes, jobs, projects] = await Promise.all([
    fetchWork("leads", "id,title,stage,created_at"),
    fetchWork("quotes", "id,title,status,amount,currency,created_at"),
    fetchWork("jobs", "id,title,status,amount,currency,created_at"),
    fetchWork("projects", "id,title,status,created_at"),
  ]);
  result.work = {
    leads: leads.map((r) => item(r, "stage", false)),
    quotes: quotes.map((r) => item(r, "status", true)),
    jobs: jobs.map((r) => item(r, "status", true)),
    projects: projects.map((r) => item(r, "status", false)),
  };

  if (can(session.role, "finance.view")) {
    const [{ data: ws_row }, { data, error }] = await Promise.all([
      db.from("workspaces").select("timezone").eq("id", ws).maybeSingle(),
      db
        .from("invoices")
        .select("id,number,status,amount,currency,issued_at,due_at,created_at")
        .eq("workspace_id", ws)
        .eq("client_id", clientId)
        .order("issued_at", { ascending: false })
        .limit(LIMIT),
    ]);
    if (error) throw toRepositoryError(error, "crossModule.invoices");
    const tz = typeof ws_row?.timezone === "string" && isValidTimeZone(ws_row.timezone) ? ws_row.timezone : "UTC";
    const today = todayInTimeZone(new Date(), tz);
    result.invoices = ((data ?? []) as unknown as Row[]).map((r): RelatedInvoice => {
      const status = String(r.status);
      const due = r.due_at ? String(r.due_at).slice(0, 10) : null;
      return {
        id: String(r.id),
        number: String(r.number),
        status: (status === "sent" || status === "partially_paid") && due && due < today ? "overdue" : status,
        amountMinor: toMinor(String(r.amount ?? "0")),
        currency: String(r.currency ?? ""),
        issuedAt: String(r.issued_at).slice(0, 10),
      };
    });
  }
  return result;
}
