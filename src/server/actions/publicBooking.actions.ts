"use server";

import { headers } from "next/headers";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { clientIpFromHeaders } from "@/server/ratelimit/rateLimiter";
import { getPublicBookingDeps } from "@/server/booking/deps";
import {
  createPublicBooking,
  getPublicSlots,
  PublicBookingError,
  type PublicBookingErrorCode,
  type PublicBookingRequestInput,
} from "@/server/booking/publicBooking.service";
import type { AvailableSlot } from "@/features/appointments/availability";
import type { PublicBookingResult } from "@/features/publicBooking/bookingRules";

/**
 * Anonymous entry points for the booking page and the embed. No session, no
 * account. Inputs are validated by the service; errors leave as stable CODES
 * (never database text); every call is rate limited in PostgreSQL.
 */
export type PublicActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: PublicBookingErrorCode | "unavailable"; retryAfterSeconds?: number };

async function run<T>(fn: (deps: ReturnType<typeof getPublicBookingDeps>, ip: string) => Promise<T>): Promise<PublicActionResult<T>> {
  if (!isSupabaseConfigured()) return { ok: false, code: "unavailable" };
  try {
    const h = await headers();
    return { ok: true, data: await fn(getPublicBookingDeps(), clientIpFromHeaders((n) => h.get(n))) };
  } catch (error) {
    if (error instanceof PublicBookingError) {
      return { ok: false, code: error.code, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) };
    }
    console.error("[public booking] unexpected failure:", error instanceof Error ? error.name : "unknown");
    return { ok: false, code: "unknown" };
  }
}

export async function getPublicSlotsAction(
  slug: string,
  serviceId: string,
  staffId: string | null,
  date: string,
): Promise<PublicActionResult<AvailableSlot[]>> {
  return run((deps, ip) => getPublicSlots(deps, { ip }, { slug, serviceId, staffId, date }));
}

export async function createPublicBookingAction(
  slug: string,
  request: Omit<PublicBookingRequestInput, "slug">,
): Promise<PublicActionResult<PublicBookingResult>> {
  return run((deps, ip) => createPublicBooking(deps, { ip }, { ...request, slug }));
}
