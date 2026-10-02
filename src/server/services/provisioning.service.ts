import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/workspace/slug";
import type { BusinessAuthProvider, AuthErrorCode } from "@/server/auth/businessAuth";
import { signUpSchema } from "@/server/validation/auth.schema";
import type { Locale } from "@/lib/i18n";

/**
 * Sign-up deliberately does NOT reveal whether an e-mail already has an
 * account (no user enumeration): "that address is taken" and "we sent you a
 * link" look identical to the person at the keyboard (`check_email`).
 *  - `signed_in`:   a brand-new account with an immediate session (only when
 *                   the provider has e-mail confirmation switched OFF —
 *                   development; the new owner goes straight to onboarding).
 *  - `check_email`: shown for a new account that must confirm its address
 *                   (production) AND for an address that already exists.
 * Production should keep e-mail confirmation ON; with it OFF, the difference
 * between the two outcomes can still be observed (see docs).
 */
export type SignUpResult =
  | { ok: true; outcome: "signed_in"; workspaceSlug: string }
  | { ok: true; outcome: "check_email" }
  | { ok: false; code: Exclude<AuthErrorCode, "email_taken"> };

/**
 * Business sign-up = create the Auth user, then provision everything the
 * workspace needs in ONE database transaction (`provision_workspace`:
 * profile, workspace, owner membership, MAIN + PRIVATE buckets, owner staff
 * profile, default hours). The two halves live in different systems, so if
 * provisioning fails the just-created Auth user is deleted again — no
 * half-made account is left behind. Retrying is safe: the RPC is idempotent.
 *
 * Uses the service-role client for the RPC only (it is granted to nobody
 * else) — an allowed use, see `lib/supabase/admin.ts`.
 */
export async function signUpOwner(
  auth: BusinessAuthProvider,
  input: unknown,
  locale: Locale,
): Promise<SignUpResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    const weak = parsed.error.issues.some((i) => i.path[0] === "password");
    return { ok: false, code: weak ? "weak_password" : "invalid_input" };
  }
  const { businessName, email, password } = parsed.data;

  const created = await auth.signUpWithPassword(email, password);
  if (!created.ok) {
    if (created.code === "email_taken") return { ok: true, outcome: "check_email" };
    return { ok: false, code: created.code };
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("provision_workspace", {
      p_user_id: created.userId,
      p_email: email,
      p_full_name: "",
      p_business_name: businessName,
      p_base_slug: slugify(businessName),
      p_locale: locale,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row?.out_slug) {
      await auth.discardUser(created.userId);
      // A stale profile already owns this e-mail: same outward answer as "taken".
      if (error?.message?.includes("profile_email_conflict")) return { ok: true, outcome: "check_email" };
      return { ok: false, code: "unknown" };
    }
    return created.hasSession
      ? { ok: true, outcome: "signed_in", workspaceSlug: row.out_slug as string }
      : { ok: true, outcome: "check_email" };
  } catch {
    await auth.discardUser(created.userId);
    return { ok: false, code: "unknown" };
  }
}
