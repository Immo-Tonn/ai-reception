import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Repository } from "@/lib/repository/types";
import type { ClientRecord, ClientTag } from "@/features/clients/types";
import { utcToZonedParts } from "@/lib/date/zoned";
import { getWorkspaceInfo } from "./workspaceInfo";

/**
 * Real Supabase-backed Repository<ClientRecord>. `lastVisit`, `upcoming`
 * and `history` are not columns — they are derived from the client's
 * appointments on every read, so they can never drift out of sync.
 */

interface ClientRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  tags: string[] | null;
  notes: string;
}

interface VisitRow {
  client_id: string;
  starts_at: string;
  status: string;
  price: number | string;
  services: { name: string } | null;
  title: string | null;
}

const KNOWN_TAGS: ClientTag[] = ["vip", "new"];

function toTags(tags: string[] | null): ClientTag[] {
  return (tags ?? []).filter((tag): tag is ClientTag => KNOWN_TAGS.includes(tag as ClientTag));
}

const cache = new Map<string, Repository<ClientRecord>>();

export function getSupabaseClientsRepository(workspaceId: string): Repository<ClientRecord> {
  const cached = cache.get(workspaceId);
  if (cached) return cached;

  const admin = createSupabaseAdminClient();

  async function loadVisits(clientIds: string[]): Promise<Map<string, VisitRow[]>> {
    const visits = new Map<string, VisitRow[]>();
    if (clientIds.length === 0) return visits;
    const { data, error } = await admin
      .from("appointments")
      .select("client_id, starts_at, status, price, title, services(name)")
      .eq("workspace_id", workspaceId)
      .in("client_id", clientIds);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as unknown as VisitRow[]) {
      const list = visits.get(row.client_id) ?? [];
      list.push(row);
      visits.set(row.client_id, list);
    }
    return visits;
  }

  async function hydrate(rows: ClientRow[]): Promise<ClientRecord[]> {
    const [info, visits] = await Promise.all([
      getWorkspaceInfo(workspaceId),
      loadVisits(rows.map((row) => row.id)),
    ]);
    const now = Date.now();

    return rows.map((row) => {
      const own = (visits.get(row.id) ?? []).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      const label = (v: VisitRow) => v.services?.name ?? v.title ?? "";

      const upcoming = own
        .filter(
          (v) =>
            new Date(v.starts_at).getTime() >= now &&
            v.status !== "cancelled" &&
            v.status !== "no_show",
        )
        .map((v) => {
          const { date, time } = utcToZonedParts(v.starts_at, info.timezone);
          return { date, time, service: label(v) };
        });

      const history = own
        .filter((v) => v.status === "completed")
        .map((v) => ({
          date: utcToZonedParts(v.starts_at, info.timezone).date,
          service: label(v),
          price: Number(v.price),
        }));

      return {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        tags: toTags(row.tags),
        lastVisit: history.length > 0 ? history[history.length - 1].date : null,
        upcoming,
        history,
        notes: row.notes,
      };
    });
  }

  const repo: Repository<ClientRecord> = {
    async list() {
      const { data, error } = await admin
        .from("clients")
        .select("id, name, email, phone, tags, notes")
        .eq("workspace_id", workspaceId)
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return hydrate((data ?? []) as ClientRow[]);
    },

    async get(id) {
      const { data, error } = await admin
        .from("clients")
        .select("id, name, email, phone, tags, notes")
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return undefined;
      const [client] = await hydrate([data as ClientRow]);
      return client;
    },

    async create(item) {
      const { data, error } = await admin
        .from("clients")
        .insert({
          ...(isUuid(item.id) ? { id: item.id } : {}),
          workspace_id: workspaceId,
          name: item.name,
          email: item.email,
          phone: item.phone,
          tags: item.tags,
          notes: item.notes,
        })
        .select("id, name, email, phone, tags, notes")
        .single();
      if (error) {
        if (error.code === "23505") {
          throw new Error("A client with this email already exists.");
        }
        throw new Error(error.message);
      }
      const [client] = await hydrate([data as ClientRow]);
      return client;
    },

    async update(id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.email !== undefined) row.email = patch.email;
      if (patch.phone !== undefined) row.phone = patch.phone;
      if (patch.tags !== undefined) row.tags = patch.tags;
      if (patch.notes !== undefined) row.notes = patch.notes;
      if (Object.keys(row).length === 0) return this.get(id);

      const { data, error } = await admin
        .from("clients")
        .update(row)
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .select("id, name, email, phone, tags, notes")
        .maybeSingle();
      if (error) {
        if (error.code === "23505") {
          throw new Error("A client with this email already exists.");
        }
        throw new Error(error.message);
      }
      if (!data) return undefined;
      const [client] = await hydrate([data as ClientRow]);
      return client;
    },

    async remove(id) {
      const { error } = await admin
        .from("clients")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },

    async replaceAll() {
      throw new Error("replaceAll is not supported for clients.");
    },
  };

  cache.set(workspaceId, repo);
  return repo;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
