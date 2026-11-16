import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getCurrentUserSafe } from "@/server/auth/supabaseBusinessAuth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findOwnerHomeSlug } from "@/server/auth/ownerHome";
import { GoogleSignupForm } from "./GoogleSignupForm";
import styles from "../../login/page.module.css";

export const metadata: Metadata = { title: "Create your workspace — ServiceOS", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Second step of "Sign up with Google": the account exists, the workspace is still to be named. */
export default async function GoogleSignupPage() {
  const user = await getCurrentUserSafe();
  if (!user) redirect("/login");
  const existing = await findOwnerHomeSlug(await createSupabaseServerClient(), user.id);
  if (existing) redirect(`/${existing}/today`);

  const { googleAuth, authErrors } = getMessages(await getRequestLocale());
  return (
    <main className={styles.screen}>
      <div className={styles.body}>
        <section className={styles.formPanel}>
          <div className={styles.formCard}>
            <div className={styles.formHeader}>
              <h1 className={styles.formTitle}>{googleAuth.completeTitle}</h1>
              <p className={styles.formSubtitle}>{googleAuth.completeSubtitle}</p>
            </div>
            <GoogleSignupForm messages={googleAuth} errors={authErrors} />
          </div>
        </section>
      </div>
    </main>
  );
}
