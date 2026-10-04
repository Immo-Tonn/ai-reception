import "server-only";
import type { MyBooking } from "@/features/clientAccount/types";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getCurrentUserSafe } from "@/server/auth/supabaseBusinessAuth";
import { getPublicBookingDeps } from "@/server/booking/deps";
import { listMyBookings } from "./clientAccount.service";
import { readPendingClaims } from "./pendingClaims";

export interface MyBookingsPageData {
  state: "unconfigured" | "signed_out" | "ready";
  bookings: MyBooking[];
  hasPendingClaims: boolean;
  email: string | null;
  /** true when signed in but the list could not be loaded (show a retry message, not an empty list). */
  loadFailed: boolean;
}

/** For the /client/bookings Server Component. Never throws for anonymous visitors. */
export async function loadMyBookingsForPage(): Promise<MyBookingsPageData> {
  if (!isSupabaseConfigured()) return { state: "unconfigured", bookings: [], hasPendingClaims: false, email: null, loadFailed: false };
  const hasPendingClaims = (await readPendingClaims()).length > 0;
  const user = await getCurrentUserSafe();
  if (!user) return { state: "signed_out", bookings: [], hasPendingClaims, email: null, loadFailed: false };
  try {
    const bookings = await listMyBookings(getPublicBookingDeps(), user.id);
    return { state: "ready", bookings, hasPendingClaims, email: user.email, loadFailed: false };
  } catch {
    return { state: "ready", bookings: [], hasPendingClaims, email: user.email, loadFailed: true };
  }
}
