import type { Metadata } from "next";
import Link from "next/link";
import { GOOGLE_CALENDAR_SECTION_ID } from "@/content/legal/googleCalendarPrivacy";
import { cookies } from "next/headers";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Button } from "@/components/ui";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { PublicFooter } from "@/components/layout/PublicFooter/PublicFooter";
import { getExternalCalendarDeps } from "@/server/externalCalendar/deps";
import { SETUP_COOKIE, getCalendarChoices } from "@/server/externalCalendar/service";
import { parseConnectError, toConnectError, type ConnectPageError } from "@/server/externalCalendar/http";
import { disconnectFromSetupAction, saveCalendarsAction } from "../actions";
import { connectErrorText } from "../errors";
import styles from "../connect.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Google Calendar — ServiceOS",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Calendar picker right after Google consent. Only the connecting person gets
 * here (sealed 30-minute setup cookie set by the OAuth callback). Calendar
 * names are read live from Google for this page and never stored.
 */
export default async function CalendarSetupPage({ searchParams }: { searchParams: Promise<{ error?: string | string[]; saved?: string; disconnected?: string }> }) {
  const [{ error, saved, disconnected }, locale, store] = await Promise.all([searchParams, getRequestLocale(), cookies()]);
  const { connectCalendar: m, calendarIntegration: ci } = getMessages(locale);

  const queryError = parseConnectError(error);
  let choices: Awaited<ReturnType<typeof getCalendarChoices>> | null = null;
  let loadError: ConnectPageError | null = null;
  const setup = store.get(SETUP_COOKIE)?.value;
  if (setup && isSupabaseConfigured()) {
    try {
      choices = await getCalendarChoices(getExternalCalendarDeps(), setup);
    } catch (e) {
      loadError = toConnectError(e);
    }
  }

  return (
    <main className={styles.screen}>
      <div className={styles.topBar}>
        <Preferences />
      </div>
      <div className={styles.body}>
        <h1 className={styles.title}>{choices ? m.setupTitle : m.title}</h1>

        {queryError && (
          <p className={`${styles.notice} ${styles.error}`} role="alert">
            {connectErrorText(queryError, m)}
          </p>
        )}
        {disconnected === "1" && !queryError && (
          <p className={`${styles.notice} ${styles.success}`} role="status">
            {m.disconnected}
          </p>
        )}
        {saved === "1" && !queryError && (
          <p className={`${styles.notice} ${styles.success}`} role="status">
            {m.saved}
          </p>
        )}

        {choices ? (
          <>
            <p className={styles.lead}>{m.setupIntro.replace("{name}", choices.staffName).replace("{business}", choices.workspaceName)}</p>
            <form suppressHydrationWarning action={saveCalendarsAction} className={`${styles.card} ${styles.form}`}>
              <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                <legend className={styles.cardTitle}>{m.setupLimit.replace("{n}", String(choices.maxCalendars))}</legend>
                {choices.calendars.map((c) => (
                  <label key={c.id} className={styles.option}>
                    <input suppressHydrationWarning type="checkbox" name="calendar" value={c.id} defaultChecked={c.selected} />
                    <span>
                      {c.name}
                      {c.primary && <span className={styles.optionMeta}>{m.primary}</span>}
                    </span>
                  </label>
                ))}
              </fieldset>
              <Button type="submit" fullWidth>{m.save}</Button>
            </form>
            <section className={styles.card} aria-labelledby="privacy-title">
              <h2 id="privacy-title" className={styles.cardTitle}>{ci.privacyTitle}</h2>
              <ul className={styles.points}>
                <li>{ci.privacy1}</li>
                <li>{ci.privacy2}</li>
                <li>{ci.privacy3}</li>
              </ul>
              <p className={styles.hint}>{m.purpose}</p>
              <p className={styles.hint}>
                <Link href={`/datenschutz#${GOOGLE_CALENDAR_SECTION_ID}`} className={styles.link}>{m.privacyLink}</Link>
              </p>
            </section>
            <form suppressHydrationWarning action={disconnectFromSetupAction} className={styles.form}>
              <Button type="submit" variant="secondary" fullWidth>{m.disconnectButton}</Button>
            </form>
          </>
        ) : (
          !queryError && disconnected !== "1" && <p className={styles.notice}>{loadError ? connectErrorText(loadError, m) : m.sessionExpired}</p>
        )}
        <p className={styles.hint}>{m.revokeHint}</p>
      </div>
      <PublicFooter />
    </main>
  );
}
