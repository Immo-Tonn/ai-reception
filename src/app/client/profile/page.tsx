import Link from "next/link";
import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getCurrentUserSafe } from "@/server/auth/supabaseBusinessAuth";
import { clientAuthHref } from "@/features/clientAccount/redirect";
import { ClientNav } from "@/components/layout/ClientNav/ClientNav";
import { ProfileView } from "./ProfileView";
import styles from "../bookings/BookingsView.module.css";

export const metadata: Metadata = {
  title: "Profile — ServiceOS",
};

export default async function ClientProfilePage() {
  const locale = await getRequestLocale();
  const { client } = getMessages(locale);
  const user = isSupabaseConfigured() ? await getCurrentUserSafe() : null;

  if (!user) {
    return (
      <main className={styles.screen}>
        <ClientNav client={client} active="profile" showSignOut={false} />
        <div className={styles.body}>
          <h1 className={styles.title}>{client.profileTitle}</h1>
          <div className={styles.signInPrompt}>
            <p>{client.profileSignedOut}</p>
            <div className={styles.promptActions}>
              <Link href={clientAuthHref("login", "/client/profile")} className={styles.primaryLink}>
                {client.loginLink}
              </Link>
              <Link href={clientAuthHref("signup", "/client/profile")} className={styles.secondaryLink}>
                {client.createAccountCta}
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.screen}>
      <ClientNav client={client} active="profile" />
      <ProfileView locale={locale} client={client} />
    </main>
  );
}
