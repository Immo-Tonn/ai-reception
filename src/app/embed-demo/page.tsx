import type { Metadata } from "next";
import Script from "next/script";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { ResizingIframe } from "./ResizingIframe";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Embed preview — ServiceOS",
};

const DEMO_WORKSPACE = "demo";

export default async function EmbedDemoPage() {
  const locale = await getRequestLocale();
  const { embed } = getMessages(locale);

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>{embed.demoTitle}</h1>
        <p className={styles.subtitle}>{embed.demoDescription}</p>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{embed.iframeTitle}</h2>
          <div className={styles.fakeSiteCard}>
            <div className={styles.fakeSiteHeader}>
              <span className={styles.fakeSiteLogo}>Anna&apos;s Beauty Studio</span>
              <nav className={styles.fakeSiteNav}>
                <span>Services</span>
                <span>About</span>
                <span>Contact</span>
              </nav>
            </div>
            <ResizingIframe src={`/book/${DEMO_WORKSPACE}/embed`} />
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{embed.modalTitle}</h2>
          <p className={styles.scriptDescription}>
            The floating button in the bottom-right corner of this page is the real{" "}
            <code>embed.js</code> loader running live — click it.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{embed.scriptTitle}</h2>
          <p className={styles.scriptDescription}>{embed.scriptDescription}</p>
          <pre className={styles.codeBlock}>
{`<script src="https://your-serviceos-domain.com/embed.js"
        data-workspace="${DEMO_WORKSPACE}"
        data-button-text="${embed.openBooking}"
        async></script>`}
          </pre>
        </section>
      </div>

      <Script
        src="/embed.js"
        data-workspace={DEMO_WORKSPACE}
        data-button-text={embed.openBooking}
        strategy="afterInteractive"
      />
    </main>
  );
}
