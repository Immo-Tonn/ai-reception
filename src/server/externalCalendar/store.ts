import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BusyInterval,
  ExternalCalendarErrorCode,
  ExternalCalendarProviderId,
  ExternalCalendarStatus,
} from "@/features/externalCalendar/types";
import { parseStoredBusy } from "@/features/externalCalendar/normalize";

/**
 * Persistence for external calendar connections and connect links
 * (migration 0025). Takes the SERVICE-ROLE client: these tables have no RLS
 * policies at all, so every caller must authorize BEFORE calling (see
 * `ExternalCalendarService`). Every query is scoped by workspace where the
 * caller knows it. Errors surface as `ExternalCalendarStoreError` without DB text.
 */
export interface ConnectionRow {
  id: string;
  workspaceId: string;
  staffId: string;
  provider: ExternalCalendarProviderId;
  status: ExternalCalendarStatus;
  refreshTokenCiphertext: string | null;
  calendarIds: string[];
  /** `null` when the stored cache is unreadable (treated as "no cache"). */
  busy: BusyInterval[] | null;
  busyWindowFrom: Date | null;
  busyWindowUntil: Date | null;
  busyFetchedAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorCode: ExternalCalendarErrorCode | null;
  lastErrorAt: Date | null;
  createdAt: Date;
}

export interface InviteRow {
  id: string;
  workspaceId: string;
  staffId: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface ExternalCalendarStore {
  listConnections(workspaceId: string): Promise<ConnectionRow[]>;
  getConnection(workspaceId: string, staffId: string): Promise<ConnectionRow | null>;
  /** Insert or replace the person's connection: new token + calendars, cache and errors reset. */
  upsertConnection(input: {
    workspaceId: string;
    staffId: string;
    provider: ExternalCalendarProviderId;
    refreshTokenCiphertext: string;
    calendarIds: string[];
    createdBy: string | null;
  }): Promise<ConnectionRow>;
  /** New calendar selection; the cache is invalidated (it described other calendars). */
  setCalendars(workspaceId: string, connectionId: string, calendarIds: string[]): Promise<void>;
  claimRefresh(connectionId: string, claimSeconds: number, backoffSeconds: number): Promise<boolean>;
  saveBusy(connectionId: string, input: { busy: BusyInterval[]; windowFrom: Date; windowUntil: Date; fetchedAt: Date }): Promise<void>;
  saveFailure(connectionId: string, input: { code: ExternalCalendarErrorCode; at: Date }): Promise<void>;
  deleteConnection(workspaceId: string, staffId: string): Promise<ConnectionRow | null>;

  issueInvite(input: { workspaceId: string; staffId: string; tokenHash: string; expiresAt: Date; createdBy: string | null }): Promise<void>;
  findInviteByHash(tokenHash: string): Promise<InviteRow | null>;
  /** Atomically marks the link used; `null` if it was already used or expired. */
  consumeInvite(inviteId: string): Promise<{ workspaceId: string; staffId: string } | null>;

  /** Names for the connect page (no other data). */
  getStaffDisplay(workspaceId: string, staffId: string): Promise<{ staffName: string; workspaceName: string; active: boolean } | null>;
  /** The staff profile linked to a signed-in user in this workspace (owner's own profile, future staff accounts). */
  getLinkedStaffId(workspaceId: string, profileId: string): Promise<string | null>;
}

export class ExternalCalendarStoreError extends Error {
  constructor() {
    super("External calendar storage failed.");
    this.name = "ExternalCalendarStoreError";
  }
}

const COLUMNS =
  "id, workspace_id, staff_id, provider, status, refresh_token_ciphertext, calendar_ids, busy_intervals, busy_window_from, busy_window_until, busy_fetched_at, last_success_at, last_error_code, last_error_at, created_at";

type Raw = Record<string, unknown>;
const date = (v: unknown) => (typeof v === "string" && v ? new Date(v) : v instanceof Date ? v : null);

function toConnection(r: Raw): ConnectionRow {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    staffId: r.staff_id as string,
    provider: r.provider as ExternalCalendarProviderId,
    status: r.status as ExternalCalendarStatus,
    refreshTokenCiphertext: (r.refresh_token_ciphertext as string | null) ?? null,
    calendarIds: Array.isArray(r.calendar_ids) ? (r.calendar_ids as string[]) : [],
    busy: parseStoredBusy(r.busy_intervals),
    busyWindowFrom: date(r.busy_window_from),
    busyWindowUntil: date(r.busy_window_until),
    busyFetchedAt: date(r.busy_fetched_at),
    lastSuccessAt: date(r.last_success_at),
    lastErrorCode: (r.last_error_code as ExternalCalendarErrorCode | null) ?? null,
    lastErrorAt: date(r.last_error_at),
    createdAt: date(r.created_at) ?? new Date(0),
  };
}

/** PostgreSQL "undefined table" / PostgREST "table not in schema cache". */
function isMissingRelation(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === "42P01" || code === "PGRST205";
}

function check<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new ExternalCalendarStoreError();
  return result.data;
}

const CACHE_RESET = {
  busy_intervals: [],
  busy_window_from: null,
  busy_window_until: null,
  busy_fetched_at: null,
  refresh_claimed_at: null,
};

export function createSupabaseExternalCalendarStore(admin: SupabaseClient): ExternalCalendarStore {
  const connections = () => admin.from("external_calendar_connections");
  const getConnection = async (workspaceId: string, staffId: string) => {
    const row = check(await connections().select(COLUMNS).eq("workspace_id", workspaceId).eq("staff_id", staffId).maybeSingle()) as Raw | null;
    return row ? toConnection(row) : null;
  };

  return {
    async listConnections(workspaceId) {
      const result = await connections().select(COLUMNS).eq("workspace_id", workspaceId);
      // Code deployed before migration 0025: without the table no calendar can be connected, so "none" is exact.
      if (result.error && isMissingRelation(result.error)) return [];
      return ((check(result) as Raw[] | null) ?? []).map(toConnection);
    },

    getConnection,

    async upsertConnection(input) {
      const values = {
        provider: input.provider,
        status: "connected",
        refresh_token_ciphertext: input.refreshTokenCiphertext,
        calendar_ids: input.calendarIds,
        last_success_at: null,
        last_error_code: null,
        last_error_at: null,
        created_by: input.createdBy,
        ...CACHE_RESET,
      };
      const existing = await getConnection(input.workspaceId, input.staffId);
      const row = existing
        ? (check(await connections().update(values).eq("id", existing.id).eq("workspace_id", input.workspaceId).select(COLUMNS).single()) as Raw)
        : (check(
            await connections()
              .insert({ workspace_id: input.workspaceId, staff_id: input.staffId, ...values })
              .select(COLUMNS)
              .single(),
          ) as Raw);
      return toConnection(row);
    },

    async setCalendars(workspaceId, connectionId, calendarIds) {
      check(await connections().update({ calendar_ids: calendarIds, ...CACHE_RESET }).eq("id", connectionId).eq("workspace_id", workspaceId));
    },

    async claimRefresh(connectionId, claimSeconds, backoffSeconds) {
      const data = check(
        await admin.rpc("claim_external_calendar_refresh", {
          p_connection_id: connectionId,
          p_claim_seconds: claimSeconds,
          p_backoff_seconds: backoffSeconds,
        }),
      );
      return data === true;
    },

    async saveBusy(connectionId, input) {
      check(
        await connections()
          .update({
            status: "connected",
            busy_intervals: input.busy,
            busy_window_from: input.windowFrom.toISOString(),
            busy_window_until: input.windowUntil.toISOString(),
            busy_fetched_at: input.fetchedAt.toISOString(),
            last_success_at: input.fetchedAt.toISOString(),
            last_error_code: null,
            last_error_at: null,
            refresh_claimed_at: null,
          })
          .eq("id", connectionId),
      );
    },

    async saveFailure(connectionId, input) {
      check(
        await connections()
          .update({
            ...(input.code === "revoked" ? { status: "revoked", refresh_token_ciphertext: null, ...CACHE_RESET } : { status: "error" }),
            last_error_code: input.code,
            last_error_at: input.at.toISOString(),
            refresh_claimed_at: null,
          })
          .eq("id", connectionId),
      );
    },

    async deleteConnection(workspaceId, staffId) {
      const rows = check(
        await connections().delete().eq("workspace_id", workspaceId).eq("staff_id", staffId).select(COLUMNS),
      ) as Raw[] | null;
      return rows?.[0] ? toConnection(rows[0]) : null;
    },

    async issueInvite(input) {
      check(
        await admin.rpc("issue_external_calendar_invite", {
          p_workspace_id: input.workspaceId,
          p_staff_id: input.staffId,
          p_token_hash: input.tokenHash,
          p_expires_at: input.expiresAt.toISOString(),
          p_created_by: input.createdBy,
        }),
      );
    },

    async findInviteByHash(tokenHash) {
      const row = check(
        await admin.from("external_calendar_invites").select("id, workspace_id, staff_id, expires_at, used_at").eq("token_hash", tokenHash).maybeSingle(),
      ) as Raw | null;
      if (!row) return null;
      return {
        id: row.id as string,
        workspaceId: row.workspace_id as string,
        staffId: row.staff_id as string,
        expiresAt: date(row.expires_at) ?? new Date(0),
        usedAt: date(row.used_at),
      };
    },

    async consumeInvite(inviteId) {
      const data = check(await admin.rpc("consume_external_calendar_invite", { p_invite_id: inviteId })) as Raw[] | Raw | null;
      const row = Array.isArray(data) ? data[0] : data;
      return row ? { workspaceId: row.out_workspace_id as string, staffId: row.out_staff_id as string } : null;
    },

    async getStaffDisplay(workspaceId, staffId) {
      const staff = check(
        await admin.from("staff_profiles").select("name, active").eq("id", staffId).eq("workspace_id", workspaceId).maybeSingle(),
      ) as Raw | null;
      if (!staff) return null;
      const ws = check(await admin.from("workspaces").select("name").eq("id", workspaceId).maybeSingle()) as Raw | null;
      if (!ws) return null;
      return { staffName: staff.name as string, workspaceName: ws.name as string, active: staff.active !== false };
    },

    async getLinkedStaffId(workspaceId, profileId) {
      const row = check(
        await admin.from("staff_profiles").select("id").eq("workspace_id", workspaceId).eq("profile_id", profileId).limit(1).maybeSingle(),
      ) as Raw | null;
      return row ? (row.id as string) : null;
    },
  };
}
