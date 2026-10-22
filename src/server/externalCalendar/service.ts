import { can } from "@/server/permissions/roles";
import type { Session } from "@/server/auth/resolveSession";
import type { BusyInterval, ExternalCalendarConnectionSummary, ExternalCalendarErrorCode } from "@/features/externalCalendar/types";
import { BusyIntervalOverflowError, clipBusyIntervals, normalizeBusyIntervals } from "@/features/externalCalendar/normalize";
import {
  EXTERNAL_BUSY_POLICY,
  cacheWindow,
  isCacheFresh,
  isCacheUsableWhenStale,
  requestChunks,
  type ExternalBusyMode,
} from "@/features/externalCalendar/policy";
import { CalendarProviderError, type CalendarProvider } from "./provider";
import type { ConnectionRow, ExternalCalendarStore } from "./store";
import {
  DecryptionError,
  TOKEN_RE,
  createPkcePair,
  randomToken,
  safeEqual,
  seal,
  sha256Hex,
  tokenContext,
  unseal,
  type SecretBox,
} from "./crypto";

/**
 * ExternalCalendarService — the application layer between the availability
 * engine / business UI and a `CalendarProvider` (docs/EXTERNAL_CALENDAR.md).
 *
 * Busy time: `loadExternalBusy` returns, per workspace, the busy intervals of
 * every connected staff member plus the people whose busy time could NOT be
 * confirmed (they get no slots; nobody else is affected).
 *
 * Connecting: a person connects THEIR OWN Google account through a single-use
 * connect link (no ServiceOS login needed, because staff accounts do not
 * exist yet). The owner/admin creates the link; the owner never sees a token,
 * a calendar id or a calendar name — only status, count and last check.
 */
export interface ExternalCalendarDeps {
  store: ExternalCalendarStore;
  /** `null` when Google OAuth is not configured (no client id/secret). */
  provider: CalendarProvider | null;
  /** Encrypts refresh tokens. `null` when the encryption key is missing. */
  tokens: SecretBox | null;
  /** Seals the OAuth state / PKCE / setup cookies. */
  cookies: SecretBox | null;
  /** HMAC of the verified Google account id (`sub`); null when the encryption key is missing. */
  subjects: ((subject: string) => string) | null;
  now?: () => Date;
}

export type ExternalCalendarErrorKind =
  | "forbidden"
  | "not_found"
  | "not_configured"
  | "invalid_input"
  | "invalid_link"
  | "expired_link"
  | "denied"
  | "state_mismatch"
  | "insufficient_scope"
  | "provider_error";

export class ExternalCalendarError extends Error {
  constructor(public code: ExternalCalendarErrorKind) {
    super(`External calendar: ${code}`);
    this.name = "ExternalCalendarError";
  }
}

export const CONNECT_LINK_TTL_MS = 72 * 60 * 60_000;
export const OAUTH_FLOW_TTL_MS = 10 * 60_000;
export const SETUP_SESSION_TTL_MS = 30 * 60_000;
export const FLOW_COOKIE = "serviceos_gcal_flow";
export const SETUP_COOKIE = "serviceos_gcal_setup";
export const MANAGE_COOKIE = "serviceos_gcal_manage";
export const MANAGE_SESSION_TTL_MS = 15 * 60_000;

const nowOf = (deps: Pick<ExternalCalendarDeps, "now">) => (deps.now ?? (() => new Date()))();
type ConfiguredDeps = ExternalCalendarDeps & {
  provider: CalendarProvider;
  tokens: SecretBox;
  cookies: SecretBox;
  subjects: (subject: string) => string;
};
const isConfigured = (deps: ExternalCalendarDeps): deps is ConfiguredDeps =>
  Boolean(deps.provider && deps.tokens && deps.cookies && deps.subjects);

export function isExternalCalendarConfigured(deps: ExternalCalendarDeps): boolean {
  return isConfigured(deps);
}

function toErrorCode(error: unknown): ExternalCalendarErrorCode {
  if (error instanceof CalendarProviderError) {
    switch (error.code) {
      case "revoked":
      case "unavailable":
      case "rate_limited":
      case "calendar_not_found":
      case "invalid_response":
      case "not_configured":
        return error.code;
      default:
        return "unavailable";
    }
  }
  if (error instanceof BusyIntervalOverflowError) return "invalid_response";
  // An undecryptable token is a configuration problem (key changed): keep the row, never wipe it.
  if (error instanceof DecryptionError) return "not_configured";
  return "unavailable";
}

// ---------------------------------------------------------------------------
// Busy time
// ---------------------------------------------------------------------------

export interface StaffBusyInterval extends BusyInterval {
  staffId: string;
}

export interface ExternalBusyResult {
  busy: StaffBusyInterval[];
  /** Connected people whose busy time is unknown right now: offer them nothing. */
  unconfirmedStaffIds: string[];
}

async function fetchBusy(
  deps: ExternalCalendarDeps & { provider: CalendarProvider; tokens: SecretBox },
  conn: ConnectionRow,
  from: Date,
  until: Date,
): Promise<BusyInterval[]> {
  const refreshToken = deps.tokens.decrypt(conn.refreshTokenCiphertext!, tokenContext(conn.workspaceId, conn.staffId));
  const accessToken = await deps.provider.getAccessToken(refreshToken);
  const chunks = await Promise.all(
    requestChunks(from, until).map((c) => deps.provider.getBusy(accessToken, conn.calendarIds, c.from, c.until)),
  );
  return normalizeBusyIntervals(chunks.flat(), from, until);
}

/** Busy intervals of one connection for [from, until), or `null` = unconfirmed. */
async function resolveConnection(
  deps: ExternalCalendarDeps,
  conn: ConnectionRow,
  now: Date,
  from: Date,
  until: Date,
  mode: ExternalBusyMode,
): Promise<BusyInterval[] | null> {
  if (conn.status === "revoked" || !conn.refreshTokenCiphertext) return null;
  if (conn.calendarIds.length === 0) return []; // nothing selected = nothing to subtract

  const configured = isConfigured(deps);
  const std = cacheWindow(now);
  const state = { fetchedAt: conn.busyFetchedAt, windowFrom: conn.busyWindowFrom, windowUntil: conn.busyWindowUntil };

  // Outside the cached window (e.g. the business books a year ahead): ask directly, cache nothing.
  if (from.getTime() < std.from.getTime() || until.getTime() > std.until.getTime()) {
    if (!configured) return null;
    try {
      return await fetchBusy(deps, conn, from, until);
    } catch {
      return null;
    }
  }

  if (conn.busy && isCacheFresh(state, now, mode, from, until)) return clipBusyIntervals(conn.busy, from, until);

  if (configured) {
    const backoff = mode === "browse" ? Math.round(EXTERNAL_BUSY_POLICY.backoffMs / 1000) : 0;
    const claimed = await deps.store.claimRefresh(conn.id, Math.round(EXTERNAL_BUSY_POLICY.claimMs / 1000), backoff).catch(() => false);
    if (claimed) {
      try {
        const busy = await fetchBusy(deps, conn, std.from, std.until);
        await deps.store.saveBusy(conn.id, { busy, windowFrom: std.from, windowUntil: std.until, fetchedAt: now });
        return clipBusyIntervals(busy, from, until);
      } catch (error) {
        const code = toErrorCode(error);
        await deps.store.saveFailure(conn.id, { code, at: now }).catch(() => undefined);
        if (code === "revoked") return null;
      }
    }
  }

  // No refresh (someone else is refreshing, backing off, not configured) or it failed: a recent cache is still trusted.
  if (conn.busy && isCacheUsableWhenStale(state, now, from, until)) return clipBusyIntervals(conn.busy, from, until);
  return null;
}

/**
 * External busy time of a workspace's connected staff for [from, until).
 * Storage errors propagate (the booking call then fails as a whole); provider
 * problems never do — they only make the affected person unconfirmed.
 */
export async function loadExternalBusy(
  deps: ExternalCalendarDeps,
  args: { workspaceId: string; from: Date; until: Date; mode: ExternalBusyMode; staffIds?: readonly string[] },
): Promise<ExternalBusyResult> {
  const now = nowOf(deps);
  // Time more than a day in the past never matters for a booking decision; clamping keeps requests inside the cached window.
  const from = new Date(Math.max(args.from.getTime(), cacheWindow(now).from.getTime()));
  const until = args.until;
  const all = await deps.store.listConnections(args.workspaceId);
  const relevant = args.staffIds ? all.filter((c) => args.staffIds!.includes(c.staffId)) : all;
  if (until.getTime() <= from.getTime()) return { busy: [], unconfirmedStaffIds: [] };
  const resolved = await Promise.all(
    relevant.map(async (conn) => ({ conn, busy: await resolveConnection(deps, conn, now, from, until, args.mode) })),
  );
  const result: ExternalBusyResult = { busy: [], unconfirmedStaffIds: [] };
  for (const { conn, busy } of resolved) {
    if (busy === null) result.unconfirmedStaffIds.push(conn.staffId);
    else for (const b of busy) result.busy.push({ staffId: conn.staffId, ...b });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Authorization helpers
// ---------------------------------------------------------------------------

/** Owner/admin (`staff.manage`) for anyone in the workspace; anyone else only for the staff profile linked to them. */
async function assertMayManage(deps: ExternalCalendarDeps, session: Session, staffId: string): Promise<void> {
  if (can(session.role, "staff.manage")) return;
  const own = await deps.store.getLinkedStaffId(session.workspaceId, session.userId);
  if (own && own === staffId) return;
  throw new ExternalCalendarError("forbidden");
}

function summarize(conn: ConnectionRow): ExternalCalendarConnectionSummary {
  return {
    staffId: conn.staffId,
    provider: conn.provider,
    status: conn.status,
    calendarCount: conn.calendarIds.length,
    lastSuccessAt: conn.lastSuccessAt?.toISOString() ?? null,
    lastErrorCode: conn.lastErrorCode,
    lastErrorAt: conn.lastErrorAt?.toISOString() ?? null,
    connectedAt: conn.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Business side: status, connect link, refresh, disconnect
// ---------------------------------------------------------------------------

export interface ExternalCalendarOverview {
  configured: boolean;
  /** true = owner/admin: sees and manages every staff member. */
  managesAll: boolean;
  /** The caller's own staff profile, if linked. */
  ownStaffId: string | null;
  connections: ExternalCalendarConnectionSummary[];
}

export async function getExternalCalendarOverview(deps: ExternalCalendarDeps, session: Session): Promise<ExternalCalendarOverview> {
  const managesAll = can(session.role, "staff.manage");
  const ownStaffId = await deps.store.getLinkedStaffId(session.workspaceId, session.userId);
  if (!managesAll && !ownStaffId) throw new ExternalCalendarError("forbidden");
  const rows = await deps.store.listConnections(session.workspaceId);
  const visible = managesAll ? rows : rows.filter((r) => r.staffId === ownStaffId);
  return { configured: isConfigured(deps), managesAll, ownStaffId, connections: visible.map(summarize) };
}

/** Creates a single-use connect link for one staff member (72 h). Earlier unused links for that person stop working. */
export async function createConnectLink(
  deps: ExternalCalendarDeps,
  session: Session,
  staffId: string,
  baseUrl: string,
): Promise<{ url: string; expiresAt: string }> {
  if (!isConfigured(deps)) throw new ExternalCalendarError("not_configured");
  await assertMayManage(deps, session, staffId);
  const display = await deps.store.getStaffDisplay(session.workspaceId, staffId);
  if (!display || !display.active) throw new ExternalCalendarError("not_found");

  const token = randomToken();
  const expiresAt = new Date(nowOf(deps).getTime() + CONNECT_LINK_TTL_MS);
  await deps.store.issueInvite({
    workspaceId: session.workspaceId,
    staffId,
    tokenHash: sha256Hex(token),
    expiresAt,
    createdBy: session.userId,
  });
  return { url: `${baseUrl}/connect-calendar/${token}`, expiresAt: expiresAt.toISOString() };
}

/** "Check now": forces a refresh (ignores the back-off) and returns the new status. */
export async function refreshConnectionNow(deps: ExternalCalendarDeps, session: Session, staffId: string): Promise<ExternalCalendarConnectionSummary> {
  await assertMayManage(deps, session, staffId);
  const now = nowOf(deps);
  await loadExternalBusy(deps, { workspaceId: session.workspaceId, staffIds: [staffId], mode: "commit", from: now, until: new Date(now.getTime() + 60_000) });
  const conn = await deps.store.getConnection(session.workspaceId, staffId);
  if (!conn) throw new ExternalCalendarError("not_found");
  return summarize(conn);
}

// ---------------------------------------------------------------------------
// Removing a connection — the ONE place that decides about revoking at Google
// ---------------------------------------------------------------------------

/**
 * Google revokes the WHOLE grant of a Google account for our project when any
 * of its tokens is revoked (all scopes, every token, every client of the
 * project). So a token is revoked only when no other ServiceOS connection of
 * the same Google account (same subject hash) remains — otherwise removing one
 * business's connection would silently break the others. Connections made
 * before migration 0026 have no subject hash: the grant cannot be attributed,
 * so it is NOT revoked (ServiceOS deletes its copy of the token; the person can
 * remove the access in their Google account).
 */
async function releaseGrant(deps: ExternalCalendarDeps, subjectHash: string | null, refreshToken: string | null): Promise<"revoked" | "kept_shared" | "kept_unknown" | "none"> {
  if (!refreshToken || !deps.provider) return "none";
  if (!subjectHash) return "kept_unknown";
  const others = await deps.store.listConnectionsBySubject(subjectHash);
  if (others.some((c) => c.status !== "revoked")) return "kept_shared";
  await deps.provider.revoke(refreshToken); // never throws
  return "revoked";
}

function decryptOrNull(deps: ExternalCalendarDeps, conn: ConnectionRow): string | null {
  if (!conn.refreshTokenCiphertext || !deps.tokens) return null;
  try {
    return deps.tokens.decrypt(conn.refreshTokenCiphertext, tokenContext(conn.workspaceId, conn.staffId));
  } catch {
    return null;
  }
}

/** Deletes one connection (token, calendar ids, cache, status) and releases the Google grant if nothing else uses it. */
async function removeConnection(deps: ExternalCalendarDeps, conn: ConnectionRow) {
  const removed = await deps.store.deleteConnection(conn.workspaceId, conn.staffId);
  if (!removed) return null;
  const grant = await releaseGrant(deps, removed.subjectHash, decryptOrNull(deps, removed));
  return { removed, grant };
}

/** Business side: removes the connection and its cached busy time. */
export async function disconnectExternalCalendar(deps: ExternalCalendarDeps, session: Session, staffId: string): Promise<void> {
  await assertMayManage(deps, session, staffId);
  const conn = await deps.store.getConnection(session.workspaceId, staffId);
  if (!conn || !(await removeConnection(deps, conn))) throw new ExternalCalendarError("not_found");
}

/**
 * Staff deactivated: the integration is removed right away (an inactive person
 * is never bookable, the data has no purpose). Never fails the deactivation:
 * the daily cleanup retries anything left behind.
 */
export async function removeConnectionForInactiveStaff(deps: ExternalCalendarDeps, workspaceId: string, staffId: string): Promise<boolean> {
  try {
    const conn = await deps.store.getConnection(workspaceId, staffId);
    return conn ? Boolean(await removeConnection(deps, conn)) : false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Connecting person: connect link -> Google consent -> calendar choice
// ---------------------------------------------------------------------------

export type ConnectLinkState =
  | { state: "valid"; workspaceName: string; staffName: string; alreadyConnected: boolean }
  | { state: "invalid" | "expired" | "used" };

export async function describeConnectLink(deps: ExternalCalendarDeps, token: string): Promise<ConnectLinkState> {
  if (!TOKEN_RE.test(token)) return { state: "invalid" };
  const invite = await deps.store.findInviteByHash(sha256Hex(token));
  if (!invite) return { state: "invalid" };
  if (invite.usedAt) return { state: "used" };
  if (invite.expiresAt.getTime() <= nowOf(deps).getTime()) return { state: "expired" };
  const display = await deps.store.getStaffDisplay(invite.workspaceId, invite.staffId);
  if (!display || !display.active) return { state: "invalid" };
  const existing = await deps.store.getConnection(invite.workspaceId, invite.staffId);
  return { state: "valid", workspaceName: display.workspaceName, staffName: display.staffName, alreadyConnected: Boolean(existing) };
}

/** Sealed OAuth flow cookie (10 min, single use): CSRF state, PKCE verifier, OIDC nonce. */
type FlowCookie =
  | { kind: "connect"; state: string; verifier: string; nonce: string; inviteId: string }
  | { kind: "manage"; state: string; verifier: string; nonce: string };

interface SetupCookie {
  workspaceId: string;
  staffId: string;
  connectionId: string;
}

interface ManageCookie {
  subjectHash: string;
}

function newFlow(deps: ConfiguredDeps, redirectUri: string, purpose: "connect" | "identify", extra: { inviteId?: string }) {
  const state = randomToken();
  const nonce = randomToken();
  const { verifier, challenge } = createPkcePair();
  const flow: FlowCookie =
    purpose === "connect" ? { kind: "connect", state, verifier, nonce, inviteId: extra.inviteId! } : { kind: "manage", state, verifier, nonce };
  return {
    authorizationUrl: deps.provider.buildAuthorizationUrl({ state, codeChallenge: challenge, redirectUri, nonce, purpose }),
    flowCookie: seal(deps.cookies, FLOW_COOKIE, flow, new Date(nowOf(deps).getTime() + OAUTH_FLOW_TTL_MS)),
    maxAgeSeconds: OAUTH_FLOW_TTL_MS / 1000,
  };
}

/** Step 1: validates the link and returns the consent URL plus the sealed state/PKCE/nonce cookie. */
export async function startAuthorization(
  deps: ExternalCalendarDeps,
  token: string,
  redirectUri: string,
): Promise<{ authorizationUrl: string; flowCookie: string; maxAgeSeconds: number }> {
  if (!isConfigured(deps)) throw new ExternalCalendarError("not_configured");
  const link = await describeConnectLink(deps, token);
  if (link.state !== "valid") throw new ExternalCalendarError(link.state === "expired" || link.state === "used" ? "expired_link" : "invalid_link");
  const invite = (await deps.store.findInviteByHash(sha256Hex(token)))!;
  return newFlow(deps, redirectUri, "connect", { inviteId: invite.id });
}

/** Manage page: "Sign in with Google" (openid only) to prove which Google account is yours. */
export async function startIdentification(
  deps: ExternalCalendarDeps,
  redirectUri: string,
): Promise<{ authorizationUrl: string; flowCookie: string; maxAgeSeconds: number }> {
  if (!isConfigured(deps)) throw new ExternalCalendarError("not_configured");
  return newFlow(deps, redirectUri, "identify", {});
}

export type CallbackOutcome =
  | { kind: "connect"; setupCookie: string; maxAgeSeconds: number }
  | { kind: "manage"; manageCookie: string; maxAgeSeconds: number };

/**
 * The OAuth callback (one redirect URI for both flows): state check (CSRF,
 * timing-safe), then the flow recorded in the sealed cookie decides what the
 * code is exchanged for. The ID token of either flow is verified (signature,
 * iss, aud, exp, nonce) inside the provider.
 */
export async function completeOAuthCallback(
  deps: ExternalCalendarDeps,
  params: { flowCookie: string | undefined; state: string | null; code: string | null; error: string | null; redirectUri: string },
): Promise<CallbackOutcome> {
  if (!isConfigured(deps)) throw new ExternalCalendarError("not_configured");
  const flow = unseal<FlowCookie>(deps.cookies, FLOW_COOKIE, params.flowCookie, nowOf(deps));
  if (!flow || !params.state || !safeEqual(flow.state, params.state)) throw new ExternalCalendarError("state_mismatch");
  if (params.error) throw new ExternalCalendarError("denied");
  if (!params.code || params.code.length > 2048) throw new ExternalCalendarError("invalid_input");
  if (flow.kind === "manage") return completeIdentification(deps, flow, params.code, params.redirectUri);
  if (flow.kind !== "connect") throw new ExternalCalendarError("state_mismatch");
  return { kind: "connect", ...(await completeConnect(deps, flow, params.code, params.redirectUri)) };
}

/** Kept for callers/tests of the connect flow. */
export async function completeAuthorization(
  deps: ExternalCalendarDeps,
  params: { flowCookie: string | undefined; state: string | null; code: string | null; error: string | null; redirectUri: string },
): Promise<{ setupCookie: string; maxAgeSeconds: number }> {
  const outcome = await completeOAuthCallback(deps, params);
  if (outcome.kind !== "connect") throw new ExternalCalendarError("state_mismatch");
  return outcome;
}

/**
 * Connect flow: code exchange (PKCE + nonce), all scopes required, verified
 * Google account id -> HMAC, single-use consumption of the link, encrypted
 * storage of the refresh token. The primary calendar is selected by default.
 */
async function completeConnect(
  deps: ConfiguredDeps,
  flow: Extract<FlowCookie, { kind: "connect" }>,
  code: string,
  redirectUri: string,
): Promise<{ setupCookie: string; maxAgeSeconds: number }> {
  const now = nowOf(deps);
  let refreshToken: string;
  let subjectHash: string;
  try {
    const result = await deps.provider.exchangeCode({ code, codeVerifier: flow.verifier, redirectUri, nonce: flow.nonce });
    refreshToken = result.refreshToken;
    subjectHash = deps.subjects(result.subject);
  } catch (error) {
    if (error instanceof CalendarProviderError && error.code === "insufficient_scope") throw new ExternalCalendarError("insufficient_scope");
    throw new ExternalCalendarError("provider_error");
  }

  let primaryId: string | null;
  try {
    const calendars = await deps.provider.listCalendars(await deps.provider.getAccessToken(refreshToken));
    primaryId = calendars.find((c) => c.primary)?.id ?? null;
  } catch {
    await releaseGrant(deps, subjectHash, refreshToken);
    throw new ExternalCalendarError("provider_error");
  }

  const consumed = await deps.store.consumeInvite(flow.inviteId);
  if (!consumed) {
    await releaseGrant(deps, subjectHash, refreshToken);
    throw new ExternalCalendarError("expired_link");
  }

  const previous = await deps.store.getConnection(consumed.workspaceId, consumed.staffId);
  const conn = await deps.store.upsertConnection({
    workspaceId: consumed.workspaceId,
    staffId: consumed.staffId,
    provider: deps.provider.id,
    refreshTokenCiphertext: deps.tokens.encrypt(refreshToken, tokenContext(consumed.workspaceId, consumed.staffId)),
    calendarIds: primaryId ? [primaryId] : [],
    createdBy: null,
    subjectHash,
  });
  // Reconnect with a DIFFERENT Google account: the old account's grant goes only if nothing else uses it.
  // Same account: it is the same grant at Google — revoking the old token would kill the new one.
  if (previous && previous.subjectHash !== subjectHash) {
    await releaseGrant(deps, previous.subjectHash, decryptOrNull(deps, previous));
  }
  // Fill the cache right away (best effort; the next booking request would do it too).
  await loadExternalBusy(deps, { workspaceId: conn.workspaceId, staffIds: [conn.staffId], mode: "commit", from: now, until: new Date(now.getTime() + 60_000) }).catch(() => undefined);

  const setup: SetupCookie = { workspaceId: conn.workspaceId, staffId: conn.staffId, connectionId: conn.id };
  return { setupCookie: seal(deps.cookies, SETUP_COOKIE, setup, new Date(now.getTime() + SETUP_SESSION_TTL_MS)), maxAgeSeconds: SETUP_SESSION_TTL_MS / 1000 };
}

async function completeIdentification(
  deps: ConfiguredDeps,
  flow: Extract<FlowCookie, { kind: "manage" }>,
  code: string,
  redirectUri: string,
): Promise<CallbackOutcome> {
  let subject: string;
  try {
    ({ subject } = await deps.provider.exchangeIdentity({ code, codeVerifier: flow.verifier, redirectUri, nonce: flow.nonce }));
  } catch {
    throw new ExternalCalendarError("provider_error");
  }
  const manage: ManageCookie = { subjectHash: deps.subjects(subject) };
  return {
    kind: "manage",
    manageCookie: seal(deps.cookies, MANAGE_COOKIE, manage, new Date(nowOf(deps).getTime() + MANAGE_SESSION_TTL_MS)),
    maxAgeSeconds: MANAGE_SESSION_TTL_MS / 1000,
  };
}

async function setupContext(deps: ExternalCalendarDeps, setupCookie: string | undefined) {
  if (!isConfigured(deps)) throw new ExternalCalendarError("not_configured");
  const setup = unseal<SetupCookie>(deps.cookies, SETUP_COOKIE, setupCookie, nowOf(deps));
  if (!setup) throw new ExternalCalendarError("expired_link");
  const conn = await deps.store.getConnection(setup.workspaceId, setup.staffId);
  if (!conn || conn.id !== setup.connectionId || !conn.refreshTokenCiphertext) throw new ExternalCalendarError("expired_link");
  const display = await deps.store.getStaffDisplay(setup.workspaceId, setup.staffId);
  if (!display) throw new ExternalCalendarError("expired_link");
  let calendars;
  try {
    const refreshToken = deps.tokens.decrypt(conn.refreshTokenCiphertext, tokenContext(conn.workspaceId, conn.staffId));
    calendars = await deps.provider.listCalendars(await deps.provider.getAccessToken(refreshToken));
  } catch {
    throw new ExternalCalendarError("provider_error");
  }
  return { conn, display, calendars };
}

export interface CalendarChoice {
  id: string;
  name: string;
  primary: boolean;
  selected: boolean;
}

/** Calendar picker for the connecting person only (sealed setup cookie, 30 min). Names are never stored. */
export async function getCalendarChoices(
  deps: ExternalCalendarDeps,
  setupCookie: string | undefined,
): Promise<{ workspaceName: string; staffName: string; calendars: CalendarChoice[]; maxCalendars: number }> {
  const { conn, display, calendars } = await setupContext(deps, setupCookie);
  return {
    workspaceName: display.workspaceName,
    staffName: display.staffName,
    maxCalendars: EXTERNAL_BUSY_POLICY.maxCalendars,
    calendars: calendars.map((c) => ({ ...c, selected: conn.calendarIds.includes(c.id) })),
  };
}

export async function saveCalendarChoices(deps: ExternalCalendarDeps, setupCookie: string | undefined, calendarIds: unknown): Promise<void> {
  if (!Array.isArray(calendarIds) || calendarIds.some((id) => typeof id !== "string")) throw new ExternalCalendarError("invalid_input");
  const unique = [...new Set(calendarIds as string[])];
  if (unique.length < 1 || unique.length > EXTERNAL_BUSY_POLICY.maxCalendars) throw new ExternalCalendarError("invalid_input");
  const { conn, calendars } = await setupContext(deps, setupCookie);
  // Only calendars this Google account really has (no arbitrary ids, e.g. somebody else's address).
  const known = new Set(calendars.map((c) => c.id));
  if (!unique.every((id) => known.has(id))) throw new ExternalCalendarError("invalid_input");
  await deps.store.setCalendars(conn.workspaceId, conn.id, unique);
  const now = nowOf(deps);
  await loadExternalBusy(deps, { workspaceId: conn.workspaceId, staffIds: [conn.staffId], mode: "commit", from: now, until: new Date(now.getTime() + 60_000) }).catch(() => undefined);
}

/** The connecting person disconnects from the calendar picker (sealed setup cookie, 30 min). */
export async function disconnectFromSetup(deps: ExternalCalendarDeps, setupCookie: string | undefined): Promise<void> {
  if (!isConfigured(deps)) throw new ExternalCalendarError("not_configured");
  const setup = unseal<SetupCookie>(deps.cookies, SETUP_COOKIE, setupCookie, nowOf(deps));
  if (!setup) throw new ExternalCalendarError("expired_link");
  const conn = await deps.store.getConnection(setup.workspaceId, setup.staffId);
  if (!conn || conn.id !== setup.connectionId) throw new ExternalCalendarError("expired_link");
  await removeConnection(deps, conn);
}

// ---------------------------------------------------------------------------
// Manage page: every connection of the signed-in Google account, any time
// ---------------------------------------------------------------------------

export interface ManagedConnection {
  connectionId: string;
  workspaceName: string;
  staffName: string;
  status: ExternalCalendarConnectionSummary["status"];
  connectedAt: string;
}

function manageSession(deps: ExternalCalendarDeps, manageCookie: string | undefined): ManageCookie {
  if (!isConfigured(deps)) throw new ExternalCalendarError("not_configured");
  const session = unseal<ManageCookie>(deps.cookies, MANAGE_COOKIE, manageCookie, nowOf(deps));
  if (!session || !/^[0-9a-f]{64}$/.test(session.subjectHash)) throw new ExternalCalendarError("expired_link");
  return session;
}

/** Connections of the Google account proven by the manage session — across businesses, names only. */
export async function listManagedConnections(deps: ExternalCalendarDeps, manageCookie: string | undefined): Promise<ManagedConnection[]> {
  const { subjectHash } = manageSession(deps, manageCookie);
  const rows = await deps.store.listConnectionsBySubject(subjectHash);
  const out: ManagedConnection[] = [];
  for (const row of rows) {
    const display = await deps.store.getStaffDisplay(row.workspaceId, row.staffId);
    out.push({
      connectionId: row.id,
      workspaceName: display?.workspaceName ?? "",
      staffName: display?.staffName ?? "",
      status: row.status,
      connectedAt: row.createdAt.toISOString(),
    });
  }
  return out.sort((a, b) => a.workspaceName.localeCompare(b.workspaceName));
}

/**
 * Disconnects ONE connection of the signed-in account (it must carry the same
 * subject hash — another person's connection id is "not found"). The Google
 * grant is revoked only when it was the account's last ServiceOS connection.
 */
export async function disconnectManagedConnection(
  deps: ExternalCalendarDeps,
  manageCookie: string | undefined,
  connectionId: string,
): Promise<"revoked" | "kept_shared" | "kept_unknown" | "none"> {
  const { subjectHash } = manageSession(deps, manageCookie);
  const conn = (await deps.store.listConnectionsBySubject(subjectHash)).find((c) => c.id === connectionId);
  if (!conn) throw new ExternalCalendarError("not_found");
  const result = await removeConnection(deps, conn);
  if (!result) throw new ExternalCalendarError("not_found");
  return result.grant;
}

/** Disconnects every connection of the signed-in account and then revokes the Google grant once. */
export async function disconnectAllManagedConnections(deps: ExternalCalendarDeps, manageCookie: string | undefined): Promise<number> {
  const { subjectHash } = manageSession(deps, manageCookie);
  const rows = await deps.store.listConnectionsBySubject(subjectHash);
  let token: string | null = null;
  let removed = 0;
  for (const row of rows) {
    const gone = await deps.store.deleteConnection(row.workspaceId, row.staffId);
    if (!gone) continue;
    removed += 1;
    token ??= decryptOrNull(deps, gone);
  }
  if (removed > 0) await releaseGrant(deps, subjectHash, token);
  return removed;
}

// ---------------------------------------------------------------------------
// Retention cleanup (docs/DATA_RETENTION.md) — daily Vercel Cron
// ---------------------------------------------------------------------------

export const RETENTION = {
  /** A busy cache not refreshed for this long is cleared (it is never used after 15 min anyway). */
  staleCacheMs: 24 * 60 * 60_000,
  /** Used connect links are deleted this long after use. */
  usedInviteMs: 30 * 24 * 60 * 60_000,
  /** Unused connect links are deleted this long after they expired. */
  expiredInviteMs: 30 * 24 * 60 * 60_000,
} as const;

export interface CleanupReport {
  staleCachesCleared: number;
  usedInvitesDeleted: number;
  expiredInvitesDeleted: number;
  inactiveStaffConnectionsRemoved: number;
  /** Step names that failed (no data, no messages). */
  failedSteps: string[];
}

/**
 * Idempotent: running it twice deletes nothing more the second time. Every
 * step is independent; a failing step is reported by name and the others run.
 * "Access withdrawn" statuses are NEVER removed here (they keep the person
 * blocked until a human decides) — see docs/DATA_RETENTION.md.
 */
export async function runExternalCalendarCleanup(deps: ExternalCalendarDeps): Promise<CleanupReport> {
  const now = nowOf(deps).getTime();
  const report: CleanupReport = { staleCachesCleared: 0, usedInvitesDeleted: 0, expiredInvitesDeleted: 0, inactiveStaffConnectionsRemoved: 0, failedSteps: [] };
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      report.failedSteps.push(name);
    }
  };
  await step("stale_cache", async () => {
    report.staleCachesCleared = await deps.store.clearStaleBusyCaches(new Date(now - RETENTION.staleCacheMs));
  });
  await step("used_invites", async () => {
    report.usedInvitesDeleted = await deps.store.deleteUsedInvites(new Date(now - RETENTION.usedInviteMs));
  });
  await step("expired_invites", async () => {
    report.expiredInvitesDeleted = await deps.store.deleteExpiredUnusedInvites(new Date(now - RETENTION.expiredInviteMs));
  });
  await step("inactive_staff", async () => {
    for (const conn of await deps.store.listConnectionsOfInactiveStaff()) {
      if (await removeConnection(deps, conn)) report.inactiveStaffConnectionsRemoved += 1;
    }
  });
  return report;
}
