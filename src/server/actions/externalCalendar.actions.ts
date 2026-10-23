"use server";

import { headers } from "next/headers";
import { getSession } from "@/server/auth/session";
import { getPublicBaseUrl } from "@/lib/config/publicBaseUrl";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getExternalCalendarDeps } from "@/server/externalCalendar/deps";
import {
  ExternalCalendarError,
  createConnectLink,
  disconnectExternalCalendar,
  refreshConnectionNow,
} from "@/server/externalCalendar/service";
import type { ExternalCalendarConnectionSummary } from "@/features/externalCalendar/types";
import { toActionError } from "./result";

/**
 * Business side of the Google Calendar integration. The workspace comes from
 * the SESSION (route slug verified against the user's membership), the
 * permission check lives in the service (owner/admin for anyone, everyone else
 * only for their own linked staff profile). Results carry stable codes only.
 */
export type CalendarActionCode = "forbidden" | "not_found" | "not_configured" | "invalid_input" | "unknown";
export type CalendarActionResult<T> = { ok: true; data: T } | { ok: false; code: CalendarActionCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function run<T>(workspaceSlug: string, staffId: string, fn: (session: Awaited<ReturnType<typeof getSession>>) => Promise<T>): Promise<CalendarActionResult<T>> {
  if (isDemoWorkspaceSlug(workspaceSlug)) return { ok: false, code: "forbidden" };
  if (!UUID.test(staffId)) return { ok: false, code: "invalid_input" };
  try {
    return { ok: true, data: await fn(await getSession(workspaceSlug)) };
  } catch (error) {
    if (error instanceof ExternalCalendarError) {
      const code = error.code === "forbidden" || error.code === "not_found" || error.code === "not_configured" || error.code === "invalid_input" ? error.code : "unknown";
      return { ok: false, code };
    }
    const generic = toActionError(error);
    if (generic === "unknown") console.error("[calendar] unexpected failure:", error instanceof Error ? error.name : "unknown");
    return { ok: false, code: generic === "forbidden" || generic === "unauthenticated" ? "forbidden" : generic === "not_found" ? "not_found" : "unknown" };
  }
}

export async function createCalendarConnectLinkAction(workspaceSlug: string, staffId: string): Promise<CalendarActionResult<{ url: string; expiresAt: string }>> {
  return run(workspaceSlug, staffId, async (session) => {
    const { baseUrl } = getPublicBaseUrl((await headers()).get("host"));
    if (!baseUrl) throw new ExternalCalendarError("not_configured");
    return createConnectLink(getExternalCalendarDeps(), session, staffId, baseUrl);
  });
}

export async function refreshCalendarAction(workspaceSlug: string, staffId: string): Promise<CalendarActionResult<ExternalCalendarConnectionSummary>> {
  return run(workspaceSlug, staffId, (session) => refreshConnectionNow(getExternalCalendarDeps(), session, staffId));
}

export async function disconnectCalendarAction(workspaceSlug: string, staffId: string): Promise<CalendarActionResult<null>> {
  return run(workspaceSlug, staffId, async (session) => {
    await disconnectExternalCalendar(getExternalCalendarDeps(), session, staffId);
    return null;
  });
}
