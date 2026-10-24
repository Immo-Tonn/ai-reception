import "server-only";
import type { MyBooking } from "@/features/clientAccount/types";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getCurrentUserSafe } from "@/server/auth/supabaseBusinessAuth";
import { getPublicBookingDeps } from "@/server/booking/deps";
import { listMyBookings } from "./clientAccount.service";
import { readPendingClaims } from "./pendingClaims";
import { getFeedState } from "./calendarFeed";

export interface MyBookingsPageData {
  state: "unconfigured" | "signed_out" | "ready";
  bookings: MyBooking[];
  hasPendingClaims: boolean;
  email: string | null;
  /** true when signed in but the list could not be loaded (show a retry message, not an empty list). */
  loadFailed: boolean;
  /** The client's own calendar already subscribes to their bookings (no per-booking "add" buttons). */
  calendarConnected: boolean;
}

/** Best effort: unknown = not connected (the buttons stay, nothing breaks). */
export async function isClientCalendarConnected(userId: string): Promise<boolean> {
  try {
    return (await getFeedState(getPublicBookingDeps().admin, userId)).connected;
  } catch {
    return false;
  }
}

/** For the /client/bookings Server Component. Never throws for anonymous visitors. */
export async function loadMyBookingsForPage(): Promise<MyBookingsPageData> {
  if (!isSupabaseConfigured()) return { state: "unconfigured", bookings: [], hasPendingClaims: false, email: null, loadFailed: false, calendarConnected: false };
  const hasPendingClaims = (await readPendingClaims()).length > 0;
  const user = await getCurrentUserSafe();
  if (!user) return { state: "signed_out", bookings: [], hasPendingClaims, email: null, loadFailed: false, calendarConnected: false };
  const calendarConnected = await isClientCalendarConnected(user.id);
  try {
    const bookings = await listMyBookings(getPublicBookingDeps(), user.id);
    return { state: "ready", bookings, hasPendingClaims, email: user.email, loadFailed: false, calendarConnected };
  } catch {
    return { state: "ready", bookings: [], hasPendingClaims, email: user.email, loadFailed: true, calendarConnected };
  }
}
