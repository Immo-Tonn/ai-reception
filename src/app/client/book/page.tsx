import Link from "next/link";
import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { PublicFooter } from "@/components/layout/PublicFooter/PublicFooter";
import { BackLink } from "@/components/ui";
import { demoWorkspaces } from "@/features/workspace/registry";
import { loadDiscoverableBusinesses } from "@/server/booking/discovery.service";
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
export default async function ClientDiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  // Demo businesses are developer/demo material: shown only on an explicit
  // `?demo=1` entry, never mixed into the normal client flow. Real discovery
  // (businesses that opted in to a public listing) needs a publication flag
  // that does not exist yet, so the normal view lists nothing.
  const showDemo = (await searchParams).demo === "1";
  // Real directory and demo list are exclusive: demo never touches Supabase.
  const real = showDemo ? [] : await loadDiscoverableBusinesses();
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
        <p className={styles.subtitle}>{showDemo ? client.entrySubtitle : real.length > 0 ? client.entrySubtitleReal : client.discoveryNone}</p>

        <div className={styles.businessList} role="list">
          {real.map((b) => (
            <Link key={b.slug} href={`/book/${b.slug}`} className={styles.businessCard} role="listitem">
              <span className={styles.businessInitial} aria-hidden="true">
                {[...b.name][0]?.toUpperCase()}
              </span>
              <span className={styles.businessBody}>
                <span className={styles.businessName}>{b.name}</span>
                {b.city || b.country ? (
                  <>
                    <br />
                    <span className={styles.businessTagline}>{[b.city, b.country].filter(Boolean).join(", ")}</span>
                  </>
                ) : null}
                {b.description ? (
                  <>
                    <br />
                    <span className={styles.businessTagline}>{b.description.slice(0, 140)}</span>
                  </>
                ) : null}
              </span>
              <span className={styles.businessCta}>{client.entryCta}</span>
            </Link>
          ))}
          {(showDemo ? demoWorkspaces : []).map((workspace) => (
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

        {showDemo ? <p className={styles.demoNote}>{client.demoDataNote}</p> : null}
      </div>
      <PublicFooter />
    </main>
  );
}
