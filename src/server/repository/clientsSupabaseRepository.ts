import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Repository } from "@/lib/repository/types";
import type { ClientRecord, ClientTag } from "@/features/clients/types";
import { instantToWall } from "@/lib/time/zonedTime";
import { isUuid } from "./appointmentsMapper";
import { RepositoryError, toRepositoryError } from "./errors";

interface ClientRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  tags: string[] | null;
  notes: string;
}
interface VisitRow {
  client_id: string | null;
  service_id: string | null;
  starts_at: string;
  timezone: string;
  status: string;
  price: number | string;
}

const ACTIVE = new Set(["pending", "confirmed", "checked_in", "in_progress"]);

export function clientFromRow(row: ClientRow, visits: VisitRow[], serviceNames: Map<string, string>, now: Date): ClientRecord {
  const mine = visits.filter((v) => v.client_id === row.id && v.status !== "cancelled" && v.status !== "no_show");
  const withWall = mine.map((v) => ({ v, wall: instantToWall(v.starts_at, v.timezone), at: new Date(v.starts_at).getTime() }));
  const service = (v: VisitRow) => (v.service_id ? (serviceNames.get(v.service_id) ?? "") : "");
  const past = withWall.filter((x) => x.at <= now.getTime()).sort((a, b) => b.at - a.at);
  const upcoming = withWall.filter((x) => x.at > now.getTime() && ACTIVE.has(x.v.status)).sort((a, b) => a.at - b.at);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    tags: (row.tags ?? []).filter((t): t is ClientTag => t === "vip" || t === "new"),
    lastVisit: past[0]?.wall.date ?? null,
    upcoming: upcoming.map((x) => ({ date: x.wall.date, time: x.wall.time, service: service(x.v) })),
    history: past.map((x) => ({ date: x.wall.date, service: service(x.v), price: Number(x.v.price) })),
    notes: row.notes,
  };
}

/**
 * Supabase adapter for `Repository<ClientRecord>`; runs as the signed-in user
 * (RLS: `clients.view` / `clients.edit`, tenant isolation). `lastVisit`,
 * `upcoming` and `history` are derived from the client's appointments, which
 * the caller is allowed to see. A client created by Public Booking is the same
 * row the Business app lists. E-mail is unique per workspace (database rule);
 * a duplicate surfaces as `RepositoryConflictError`.
 * Industry `customFields` are not persisted yet (no column).
 */
export function createSupabaseClientsRepository(
  workspaceId: string,
  getClient: () => Promise<SupabaseClient> = createSupabaseServerClient,
  now: () => Date = () => new Date(),
): Repository<ClientRecord> {
  async function visits(client: SupabaseClient) {
    const [appts, services] = await Promise.all([
      client.from("appointments").select("client_id,service_id,starts_at,timezone,status,price").eq("workspace_id", workspaceId),
      client.from("services").select("id,name").eq("workspace_id", workspaceId),
    ]);
    return {
      rows: ((appts.data as VisitRow[]) ?? []),
      names: new Map(((services.data as { id: string; name: string }[]) ?? []).map((s) => [s.id, s.name])),
    };
  }

  return {
    async list() {
      const client = await getClient();
      const [rows, v] = await Promise.all([
        client.from("clients").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: true }),
        visits(client),
      ]);
      if (rows.error) throw toRepositoryError(rows.error, "clients.list");
      return ((rows.data as ClientRow[]) ?? []).map((r) => clientFromRow(r, v.rows, v.names, now()));
    },

    async get(id) {
      if (!isUuid(id)) return undefined;
      const client = await getClient();
      const [row, v] = await Promise.all([client.from("clients").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle(), visits(client)]);
      if (row.error) throw toRepositoryError(row.error, "clients.get");
      return row.data ? clientFromRow(row.data as ClientRow, v.rows, v.names, now()) : undefined;
    },

    async create(item) {
      const client = await getClient();
      const { data, error } = await client
        .from("clients")
        .insert({
          workspace_id: workspaceId,
          name: item.name,
          email: item.email,
          phone: item.phone,
          tags: item.tags,
          notes: item.notes,
        })
        .select("*")
        .single();
      if (error || !data) throw toRepositoryError(error, "clients.create");
      return clientFromRow(data as ClientRow, [], new Map(), now());
    },

    async update(id, patch) {
      if (!isUuid(id)) return undefined;
      const client = await getClient();
      const row: Record<string, unknown> = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.email !== undefined) row.email = patch.email;
      if (patch.phone !== undefined) row.phone = patch.phone;
      if (patch.tags !== undefined) row.tags = patch.tags;
      if (patch.notes !== undefined) row.notes = patch.notes;
      if (Object.keys(row).length === 0) return this.get(id);
      row.updated_at = now().toISOString();
      const { data, error } = await client.from("clients").update(row).eq("workspace_id", workspaceId).eq("id", id).select("*").maybeSingle();
      if (error) throw toRepositoryError(error, "clients.update");
      if (!data) return undefined;
      const v = await visits(client);
      return clientFromRow(data as ClientRow, v.rows, v.names, now());
    },

    async remove() {
      // Clients are never hard-deleted (their appointments reference them). Archiving is a later feature.
      throw new RepositoryError("clients.remove is not supported");
    },

    async replaceAll() {
      throw new RepositoryError("clients.replaceAll is not supported");
    },
  };
}
