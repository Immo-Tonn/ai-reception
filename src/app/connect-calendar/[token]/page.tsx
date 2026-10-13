import type { Metadata } from "next";
import Link from "next/link";
import { GOOGLE_CALENDAR_SECTION_ID } from "@/content/legal/googleCalendarPrivacy";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Button } from "@/components/ui";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { PublicFooter } from "@/components/layout/PublicFooter/PublicFooter";
import { getExternalCalendarDeps } from "@/server/externalCalendar/deps";
import { describeConnectLink, isExternalCalendarConfigured, type ConnectLinkState } from "@/server/externalCalendar/service";
import { parseConnectError } from "@/server/externalCalendar/http";
import { startGoogleConnectAction } from "../actions";
import { connectErrorText } from "../errors";
import styles from "../connect.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Google Calendar — ServiceOS",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Landing page of a single-use connect link. Explains exactly what is read,
 * then hands over to Google (Server Action -> consent screen). No ServiceOS
 * login: the link is the credential, and it never reveals anything beyond the
 * business name and the person's display name.
 */
export default async function ConnectCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const [{ token }, { error }, locale] = await Promise.all([params, searchParams, getRequestLocale()]);
  const { connectCalendar: m, calendarIntegration: ci } = getMessages(locale);

  let link: ConnectLinkState = { state: "invalid" };
  let configured = false;
  if (isSupabaseConfigured()) {
    try {
      const deps = getExternalCalendarDeps();
      configured = isExternalCalendarConfigured(deps);
      link = await describeConnectLink(deps, token);
    } catch {
      link = { state: "invalid" };
    }
  }
  const errorCode = parseConnectError(error);

  return (
    <main className={styles.screen}>
      <div className={styles.topBar}>
        <Preferences />
      </div>
      <div className={styles.body}>
        <h1 className={styles.title}>{m.title}</h1>

        {link.state !== "valid" ? (
          <p className={`${styles.notice} ${styles.error}`} role="alert">
            {link.state === "invalid" ? m.invalid : m.expired}
          </p>
        ) : (
          <>
            <p className={styles.lead}>{m.intro.replace("{business}", link.workspaceName)}</p>
            <p className={styles.notice}>{m.forPerson.replace("{name}", link.staffName)}</p>

            <section className={styles.card} aria-labelledby="privacy-title">
              <h2 id="privacy-title" className={styles.cardTitle}>{ci.privacyTitle}</h2>
              <ul className={styles.points}>
                <li>{ci.privacy1}</li>
                <li>{ci.privacy2}</li>
                <li>{ci.privacy3}</li>
                <li>{ci.privacy4}</li>
              </ul>
            </section>

            <section className={styles.card} aria-labelledby="permissions-title">
              <h2 id="permissions-title" className={styles.cardTitle}>{m.permissionsTitle}</h2>
              <ul className={styles.points}>
                <li>{m.permissionFreeBusy}</li>
                <li>{m.permissionCalendarList}</li>
              </ul>
            </section>

            <section className={styles.card} aria-labelledby="stored-title">
              <h2 id="stored-title" className={styles.cardTitle}>{m.storedTitle}</h2>
              <ul className={styles.points}>
                <li>{m.stored1}</li>
                <li>{m.stored2}</li>
                <li>{m.stored3}</li>
                <li>{m.stored4}</li>
              </ul>
              <p className={styles.hint}>{m.purpose}</p>
              <p className={styles.hint}>{m.disconnectInfo}</p>
              <p className={styles.hint}>
                <Link href={`/datenschutz#${GOOGLE_CALENDAR_SECTION_ID}`} className={styles.link}>{m.privacyLink}</Link>
              </p>
            </section>

            {errorCode && (
              <p className={`${styles.notice} ${styles.error}`} role="alert">
                {connectErrorText(errorCode, m)}
              </p>
            )}
            {link.alreadyConnected && <p className={styles.notice}>{m.alreadyConnected}</p>}

            {configured ? (
              <form suppressHydrationWarning action={startGoogleConnectAction} className={styles.form}>
                <input suppressHydrationWarning type="hidden" name="token" value={token} />
                <Button type="submit" fullWidth>{m.button}</Button>
              </form>
            ) : (
              <p className={`${styles.notice} ${styles.error}`}>{m.notConfigured}</p>
            )}
            <p className={styles.hint}>{m.revokeHint}</p>
          </>
        )}
      </div>
      <PublicFooter />
    </main>
  );
}
