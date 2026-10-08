"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ClientActionErrorCode, ClientActionResult, MyBooking } from "@/features/clientAccount/types";
import type { AvailableSlot } from "@/features/appointments/availability";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { AuthErrorCode } from "@/server/auth/businessAuth";
import { getBusinessAuth } from "@/server/auth/supabaseBusinessAuth";
import { PublicBookingError } from "@/server/booking/publicBooking.service";
import { getPublicBookingDeps } from "@/server/booking/deps";
import {
  ClientAccountError,
  cancelMyBooking,
  claimBooking,
  ensureClientAccount,
  getRescheduleSlots,
  listMyBookings,
  rescheduleMyBooking,
} from "@/server/clientAccount/clientAccount.service";
import { loadMyBookingsForPage as loadPageData, type MyBookingsPageData } from "@/server/clientAccount/pageData";
import { readPendingClaims, writePendingClaims } from "@/server/clientAccount/pendingClaims";
import { safeClientRedirect } from "@/server/clientAccount/safeRedirect";

export interface ClientAuthState {
  error?: AuthErrorCode;
  /** Neutral "check your e-mail" screen: identical for new and already-registered addresses. */
  checkEmail?: boolean;
  email?: string;
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});
const signUpSchema = credentials.extend({
  password: z.string().min(8).max(128),
  fullName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  locale: z.enum(["en", "de", "uk", "ru"]).optional(),
});

const field = (formData: FormData, name: string) => {
  const v = formData.get(name);
  return typeof v === "string" && v !== "" ? v : undefined;
};

/** Account row is best effort: a failure must not block a successful sign-in. */
async function afterSignIn(userId: string, profile: { fullName?: string; phone?: string; locale?: string } = {}) {
  try {
    await ensureClientAccount(getPublicBookingDeps(), userId, profile);
  } catch {
    // ignore
  }
}

export async function signUpClientAction(_prev: ClientAuthState, formData: FormData): Promise<ClientAuthState> {
  const parsed = signUpSchema.safeParse({
    email: field(formData, "email"),
    password: field(formData, "password"),
    fullName: field(formData, "fullName"),
    phone: field(formData, "phone"),
    locale: field(formData, "locale"),
  });
  if (!parsed.success) {
    const weak = parsed.error.issues.some((i) => i.path[0] === "password");
    return { error: weak ? "weak_password" : "invalid_input" };
  }
  const { email, password, fullName, phone, locale } = parsed.data;
  const result = await getBusinessAuth().signUpWithPassword(email, password);
  if (!result.ok) {
    // Neutral for an already-registered address (no account enumeration).
    if (result.code === "email_taken") return { checkEmail: true, email };
    return { error: result.code };
  }
  if (!result.hasSession) return { checkEmail: true, email };
  await afterSignIn(result.userId, { fullName, phone, locale });
  redirect(safeClientRedirect(formData.get("redirect")));
}

export async function signInClientAction(_prev: ClientAuthState, formData: FormData): Promise<ClientAuthState> {
  const parsed = credentials.safeParse({ email: field(formData, "email"), password: field(formData, "password") });
  if (!parsed.success) return { error: "invalid_input" };
  const result = await getBusinessAuth().signInWithPassword(parsed.data.email, parsed.data.password);
  if (!result.ok) return { error: result.code };
  await afterSignIn(result.userId);
  redirect(safeClientRedirect(formData.get("redirect")));
}

export async function signOutClientAction(): Promise<void> {
  await getBusinessAuth().signOut();
  redirect("/client");
}

// ---------------------------------------------------------------------------
// My bookings
// ---------------------------------------------------------------------------

function toCode(error: unknown): ClientActionErrorCode {
  if (error instanceof ClientAccountError || error instanceof PublicBookingError) return error.code;
  console.error("[client account] unexpected failure:", error instanceof Error ? error.name : "unknown");
  return "unknown";
}

async function withUser<T>(fn: (userId: string) => Promise<T>): Promise<ClientActionResult<T>> {
  if (!isSupabaseConfigured()) return { ok: false, code: "unavailable" };
  try {
    // The user id comes ONLY from the server-verified session, never from the browser.
    const userId = await getBusinessAuth().getCurrentUserId();
    if (!userId) return { ok: false, code: "unauthenticated" };
    return { ok: true, data: await fn(userId) };
  } catch (error) {
    return { ok: false, code: toCode(error) };
  }
}

/** Attaches the guest bookings made in this browser (httpOnly cookie) to the signed-in account. */
export async function claimPendingBookingsAction(): Promise<ClientActionResult<{ claimed: number }>> {
  return withUser(async (userId) => {
    const tokens = await readPendingClaims();
    if (tokens.length === 0) return { claimed: 0 };
    const deps = getPublicBookingDeps();
    let claimed = 0;
    const processed: string[] = [];
    for (const token of tokens) {
      try {
        await claimBooking(deps, userId, token);
        claimed += 1;
        processed.push(token);
      } catch (error) {
        // Dead tokens (unknown/expired/used by someone else) are dropped; transient ones are kept for a retry.
        if (error instanceof ClientAccountError && (error.code === "not_found" || error.code === "not_manageable")) processed.push(token);
        else if (error instanceof ClientAccountError && error.code === "rate_limited") break;
      }
    }
    await writePendingClaims(tokens.filter((t) => !processed.includes(t)));
    return { claimed };
  });
}

/** Returns the refreshed list so the UI can re-render without another round trip. */
export async function cancelMyBookingAction(appointmentId: string): Promise<ClientActionResult<MyBooking[]>> {
  return withUser(async (userId) => {
    const deps = getPublicBookingDeps();
    await cancelMyBooking(deps, userId, appointmentId);
    return listMyBookings(deps, userId);
  });
}

export async function getMyRescheduleSlotsAction(appointmentId: string, date: string): Promise<ClientActionResult<AvailableSlot[]>> {
  return withUser((userId) => getRescheduleSlots(getPublicBookingDeps(), userId, appointmentId, date));
}

/** `staffId` null = any available specialist. Returns the refreshed list. */
export async function rescheduleMyBookingAction(
  appointmentId: string,
  date: string,
  time: string,
  staffId: string | null,
): Promise<ClientActionResult<MyBooking[]>> {
  return withUser(async (userId) => {
    const deps = getPublicBookingDeps();
    await rescheduleMyBooking(deps, userId, appointmentId, date, time, staffId);
    return listMyBookings(deps, userId);
  });
}

/**
 * For the /client/bookings Server Component (also reachable as an action: it takes no input and
 * only ever returns the signed-in user's OWN data; anonymous callers get "signed_out"). Never throws.
 */
export async function loadMyBookingsForPage(): Promise<MyBookingsPageData> {
  return loadPageData();
}
