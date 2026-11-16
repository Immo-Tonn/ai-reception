import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getExternalCalendarDeps } from "@/server/externalCalendar/deps";
import { isAuthorizedCronRequest } from "@/server/externalCalendar/cronAuth";
import { runExternalCalendarCleanup, type CleanupReport } from "@/server/externalCalendar/service";
import { runRetentionChecks, type RetentionReport } from "@/server/retention/retention";
import { getRetentionStore } from "@/server/retention/deps";

export const dynamic = "force-dynamic";

/**
 * Daily retention cleanup (vercel.json crons, docs/DATA_RETENTION.md,
 * docs/GDPR_IMPLEMENTATION_PLAN.md stage 3). Protected by CRON_SECRET.
 * Idempotent: a repeated or late run (the hosting plan limits cron to about once a day, +-59 min) deletes
 * nothing twice. Logs and returns COUNTS only — never ids, names, e-mail
 * addresses or tokens.
 *  1. Google Calendar integration cleanup (unchanged).
 *  2. GDPR retention checks: expired unclaimed booking claims are deleted; clients
 *     and Inbox notifications are only COUNTED (dry run, no automatic deletion).
 * The two parts are independent: a failure of one never stops the other.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, skipped: "not_configured" }, { headers: { "Cache-Control": "no-store" } });

  let calendar: CleanupReport | null = null;
  try {
    calendar = await runExternalCalendarCleanup(getExternalCalendarDeps());
    console.info("[calendar cleanup]", JSON.stringify(calendar));
  } catch (error) {
    console.error("[calendar cleanup] failed:", error instanceof Error ? error.name : "unknown");
  }

  let retention: RetentionReport | null = null;
  try {
    retention = await runRetentionChecks({ store: getRetentionStore() });
    console.info("[retention]", JSON.stringify({ startedAt: new Date().toISOString(), ...retention }));
  } catch (error) {
    console.error("[retention] failed:", error instanceof Error ? error.name : "unknown");
  }

  const failedSteps = [
    ...(calendar ? calendar.failedSteps : ["calendar_cleanup"]),
    ...(retention ? retention.failedSteps : ["retention"]),
  ];
  return NextResponse.json(
    { ...(calendar ?? {}), retention, ok: failedSteps.length === 0, failedSteps },
    { status: failedSteps.length ? 500 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
