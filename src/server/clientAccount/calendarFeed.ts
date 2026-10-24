import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildIcsCalendar, type IcsEvent } from "@/features/calendarExport/ics";
import type { MyBooking } from "@/features/clientAccount/types";

/**
 * Personal calendar subscription for a signed-in client: one secret URL that
 * Google / Apple / Outlook poll, showing ALL their bookings (moves and
 * cancellations included). No Google keys, no database migration:
 *
 *   token = "v1.<userId>.<version>.<HMAC-SHA256(secret, userId:version)>"
 *
 * `version` lives in the user's Supabase Auth app_metadata
 * (`calendar_feed_version`, server-only). "Reset link" bumps it, so every
 * older URL stops working at once.
 */
const PREFIX = "v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signature(secret: string, userId: string, version: number): string {
  return createHmac("sha256", secret).update(`client-calendar-feed:${PREFIX}:${userId}:${version}`).digest("base64url");
}

export function createFeedToken(secret: string, userId: string, version: number): string {
  return `${PREFIX}.${userId}.${version}.${signature(secret, userId, version)}`;
}

/** Parses and checks the signature; the version must still be checked against the current one. */
export function readFeedToken(secret: string, token: string): { userId: string; version: number } | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  const [, userId, versionText, sig] = parts;
  if (!UUID.test(userId) || !/^\d{1,6}$/.test(versionText)) return null;
  const version = Number(versionText);
  const expected = Buffer.from(signature(secret, userId, version));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { userId, version };
}

export async function getFeedVersion(admin: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) throw new Error("feed_user_unavailable");
  const value = (data.user.app_metadata as Record<string, unknown> | undefined)?.calendar_feed_version;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Invalidates every previously shared feed URL of this user. */
export async function bumpFeedVersion(admin: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) throw new Error("feed_user_unavailable");
  const current = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  const next = (typeof current.calendar_feed_version === "number" ? current.calendar_feed_version : 0) + 1;
  const update = await admin.auth.admin.updateUserById(userId, { app_metadata: { ...current, calendar_feed_version: next } });
  if (update.error) throw new Error("feed_reset_failed");
  return next;
}

const STATUS: Record<MyBooking["status"], IcsEvent["status"]> = {
  pending: "TENTATIVE",
  confirmed: "CONFIRMED",
  checked_in: "CONFIRMED",
  in_progress: "CONFIRMED",
  completed: "CONFIRMED",
  no_show: "CONFIRMED",
  cancelled: "CANCELLED",
  rescheduled: "CONFIRMED",
};

/** What a calendar app may show: service + business + time + status. No notes, prices or staff contacts. */
export function bookingsToIcs(
  bookings: MyBooking[],
  options: { calendarName: string; manageUrl: string | null; now: Date },
): string {
  const from = options.now.getTime() - 60 * 86_400_000; // keep the last 60 days, everything ahead
  const events: IcsEvent[] = bookings
    .filter((b) => new Date(b.endsAt).getTime() >= from)
    .map((b) => ({
      uid: `appointment-${b.id}@serviceos`,
      start: new Date(b.startsAt),
      end: new Date(b.endsAt),
      summary: [b.serviceName, b.businessName].filter(Boolean).join(" · "),
      description: [b.staffName ?? "", options.manageUrl ?? ""].filter(Boolean).join("\n"),
      url: options.manageUrl ?? undefined,
      status: STATUS[b.status] ?? "CONFIRMED",
      // Moves/cancellations must replace the old copy in the subscriber's calendar.
      sequence: Math.floor(options.now.getTime() / 60_000),
    }));
  return buildIcsCalendar(events, { name: options.calendarName, refreshMinutes: 60, now: options.now });
}
