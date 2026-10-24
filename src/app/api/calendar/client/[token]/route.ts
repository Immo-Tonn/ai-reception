import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { deriveServerSecret } from "@/lib/supabase/admin";
import { getPublicBaseUrl } from "@/lib/config/publicBaseUrl";
import { getMessages } from "@/lib/i18n";
import { getPublicBookingDeps } from "@/server/booking/deps";
import { listMyBookings } from "@/server/clientAccount/clientAccount.service";
import { bookingsToIcs, getFeedVersion, readFeedToken } from "@/server/clientAccount/calendarFeed";
import { getRateLimiter } from "@/server/ratelimit";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

/**
 * A signed-in client's calendar subscription (Google / Apple / Outlook poll
 * this URL). The secret token is the only credential; an unknown, tampered
 * or reset token answers 404 — never which part was wrong. Logs no ids.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/calendar/client/[token]">) {
  const notFound = () => new NextResponse("Not found", { status: 404, headers: PRIVATE_HEADERS });
  if (!isSupabaseConfigured()) return notFound();
  const raw = (await ctx.params).token.replace(/\.ics$/i, "");
  try {
    const parsed = readFeedToken(deriveServerSecret("client-calendar-feed"), raw);
    if (!parsed) return notFound();
    // Per subscriber, not per IP: Google fetches every user's feed from the same few addresses.
    const limit = await getRateLimiter().hit({ scope: "client_calendar_feed", limit: 60, windowSeconds: 3600 }, parsed.userId);
    if (!limit.allowed) return new NextResponse("Too many requests", { status: 429, headers: { ...PRIVATE_HEADERS, "Retry-After": String(limit.retryAfterSeconds) } });
    const deps = getPublicBookingDeps();
    if ((await getFeedVersion(deps.admin, parsed.userId)) !== parsed.version) return notFound(); // link was reset
    const bookings = await listMyBookings(deps, parsed.userId);
    const { baseUrl } = getPublicBaseUrl(request.headers.get("host"));
    const lang = request.headers.get("accept-language")?.slice(0, 2);
    const locale = lang === "de" || lang === "ru" || lang === "uk" ? lang : "en";
    const body = bookingsToIcs(bookings, {
      calendarName: getMessages(locale).client.calendarFeedName,
      manageUrl: baseUrl ? `${baseUrl}/client/bookings` : null,
      now: new Date(),
    });
    return new NextResponse(body, {
      headers: { ...PRIVATE_HEADERS, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="serviceos.ics"' },
    });
  } catch (error) {
    console.error("[client calendar feed] failed:", error instanceof Error ? error.name : "unknown");
    return new NextResponse("Unavailable", { status: 503, headers: PRIVATE_HEADERS });
  }
}
