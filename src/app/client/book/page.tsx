import Link from "next/link";
import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { BackLink } from "@/components/ui";
import { demoWorkspaces } from "@/features/workspace/registry";
import styles from "../client.module.css";

export const metadata: Metadata = {
  title: "Book an appointment — ServiceOS",
};

/**
 * Generic demo/discovery entry — NOT how a real client normally arrives
 * (that's always `/book/[workspaceSlug]` directly: a website button, an
 * embedded widget, an Instagram/QR/Google Business link, all of which
 * already know the business). This screen exists only because a local
 * demo has no such external link to click — picking a business here is
 * just a shortcut into the same `/book/[workspaceSlug]`, not a second
 * booking engine. Reached from the Client intro's "Book a service"
 * action (`/client`), not from root — the neutral root never shows this
 * picker directly (§ discovery lives one level under the intro).
 */
export default async function ClientDiscoverPage() {
  const locale = await getRequestLocale();
  const { client, common } = getMessages(locale);

  return (
    <main className={styles.screen}>
      <div className={styles.topBar}>
        <BackLink href="/client" label={common.back} />
        <Preferences />
      </div>
      <div className={styles.body}>
        <h1 className={styles.title}>{client.entryTitle}</h1>
        <p className={styles.subtitle}>{client.entrySubtitle}</p>

        <div className={styles.businessList}>
          {demoWorkspaces.map((workspace) => (
            <Link key={workspace.slug} href={`/book/${workspace.slug}`} className={styles.businessCard}>
              <span className={styles.businessEmoji} aria-hidden="true">
                {workspace.emoji}
              </span>
              <span className={styles.businessBody}>
                <span className={styles.businessName}>{workspace.name}</span>
                <br />
                <span className={styles.businessTagline}>
                  {workspace.clientDescription?.[locale] ?? workspace.tagline}
                </span>
              </span>
              <span className={styles.businessCta}>{client.entryCta}</span>
            </Link>
          ))}
        </div>

        <p className={styles.demoNote}>{client.demoDataNote}</p>
      </div>
    </main>
  );
}
