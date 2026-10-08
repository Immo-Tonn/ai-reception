import "server-only";
import { getCurrentUserSafe } from "@/server/auth/supabaseBusinessAuth";
import { claimBooking, ensureClientAccount, issueBookingClaim, type ClientAccountDeps } from "./clientAccount.service";
import { appendPendingClaim } from "./pendingClaims";

/**
 * After a successful guest booking: keep the booking reachable from "My bookings".
 * Best effort by design — NOTHING here may fail the booking itself, and the token
 * is never returned (only its fate).
 */
export async function attachClaimAfterBooking(deps: ClientAccountDeps, appointmentId: string): Promise<"linked" | "pending" | "none"> {
  try {
    const token = await issueBookingClaim(deps, appointmentId);
    if (!token) return "none";
    const user = await getCurrentUserSafe();
    if (user) {
      try {
        await ensureClientAccount(deps, user.id);
        await claimBooking(deps, user.id, token);
        return "linked";
      } catch {
        // fall through to the cookie
      }
    }
    return (await appendPendingClaim(token)) ? "pending" : "none";
  } catch {
    return "none";
  }
}
