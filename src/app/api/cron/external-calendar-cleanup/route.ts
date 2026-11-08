import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getExternalCalendarDeps } from "@/server/externalCalendar/deps";
import { isAuthorizedCronRequest } from "@/server/externalCalendar/cronAuth";
import { runExternalCalendarCleanup } from "@/server/externalCalendar/service";

export const dynamic = "force-dynamic";

/**
 * Daily retention cleanup for the Google Calendar integration (vercel.json
 * crons, docs/DATA_RETENTION.md). Protected by CRON_SECRET. Idempotent: a
 * repeated or late run (Hobby plan: once a day, ±59 min) deletes nothing twice.
 * Logs and returns COUNTS only — never ids, names, e-mail addresses or tokens.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, skipped: "not_configured" }, { headers: { "Cache-Control": "no-store" } });
  try {
    const report = await runExternalCalendarCleanup(getExternalCalendarDeps());
    console.info("[calendar cleanup]", JSON.stringify(report));
    return NextResponse.json({ ok: report.failedSteps.length === 0, ...report }, { status: report.failedSteps.length ? 500 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[calendar cleanup] failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ ok: false }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
