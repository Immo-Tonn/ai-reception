import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { formatDate } from "@/lib/i18n/format";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Button } from "@/components/ui";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { PublicFooter } from "@/components/layout/PublicFooter/PublicFooter";
import { GOOGLE_CALENDAR_SECTION_ID } from "@/content/legal/googleCalendarPrivacy";
import { getExternalCalendarDeps } from "@/server/externalCalendar/deps";
import { MANAGE_COOKIE, isExternalCalendarConfigured, listManagedConnections, type ManagedConnection } from "@/server/externalCalendar/service";
import { parseConnectError, toConnectError, type ConnectPageError } from "@/server/externalCalendar/http";
import { disconnectAllManagedAction, disconnectManagedAction, endManageAction, startManageAction } from "../actions";
import { connectErrorText } from "../errors";
import styles from "../connect.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Google Calendar — ServiceOS",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Self-service for the connecting person, any time: sign in with Google
 * (openid only, verified ID token) -> every ServiceOS connection of THAT
 * Google account (matched by the HMAC of the stable account id, never by
 * e-mail or calendar id) -> disconnect one or all. 15-minute sealed session.
 */
export default async function ManageCalendarPage({ searchParams }: { searchParams: Promise<{ error?: string | string[]; done?: string }> }) {
  const [{ error, done }, locale, store] = await Promise.all([searchParams, getRequestLocale(), cookies()]);
  const { manageCalendar: m, connectCalendar: cc, calendarIntegration: ci } = getMessages(locale);

  const session = store.get(MANAGE_COOKIE)?.value;
  let configured = false;
  let connections: ManagedConnection[] | null = null;
  let loadError: ConnectPageError | null = null;
  if (isSupabaseConfigured()) {
    try {
      const deps = getExternalCalendarDeps();
      configured = isExternalCalendarConfigured(deps);
      if (session && configured) connections = await listManagedConnections(deps, session);
    } catch (e) {
      loadError = toConnectError(e);
    }
  }
  const queryError = parseConnectError(error);
  const doneText = done === "shared" ? m.disconnectedShared : done === "revoked" ? m.disconnectedRevoked : done === "all" ? m.disconnectedAll : null;
  const statusText = (s: ManagedConnection["status"]) => (s === "revoked" ? ci.statusRevoked : s === "error" ? ci.statusError : ci.statusConnected);

  return (
    <main className={styles.screen}>
      <div className={styles.topBar}>
        <Preferences />
      </div>
      <div className={styles.body}>
        <h1 className={styles.title}>{m.title}</h1>
        {queryError && (
          <p className={`${styles.notice} ${styles.error}`} role="alert">
            {queryError === "expired_link" ? m.errExpired : connectErrorText(queryError, cc)}
          </p>
        )}
        {doneText && !queryError && (
          <p className={`${styles.notice} ${styles.success}`} role="status">
            {doneText}
          </p>
        )}

        {connections ? (
          <>
            <section className={`${styles.card} ${styles.form}`} aria-labelledby="managed-title">
              <h2 id="managed-title" className={styles.cardTitle}>{m.listTitle}</h2>
              {connections.length === 0 ? (
                <p className={styles.hint}>{m.none}</p>
              ) : (
                connections.map((c) => (
                  <form suppressHydrationWarning key={c.connectionId} action={disconnectManagedAction} className={styles.option}>
                    <input suppressHydrationWarning type="hidden" name="connectionId" value={c.connectionId} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {c.workspaceName} · {c.staffName}
                      <span className={styles.optionMeta} suppressHydrationWarning>
                        {statusText(c.status)} · {m.connectedSince.replace("{date}", formatDate(new Date(c.connectedAt), locale, { dateStyle: "medium" }))}
                      </span>
                      {c.status === "revoked" && <span className={styles.optionMeta}>{m.revokedNote}</span>}
                    </span>
                    <Button type="submit" size="sm" variant="secondary">{m.disconnect}</Button>
                  </form>
                ))
              )}
            </section>
            <p className={styles.hint}>{m.sharedNote}</p>
            {connections.length > 0 && (
              <form suppressHydrationWarning action={disconnectAllManagedAction} className={styles.form}>
                <Button type="submit" variant="destructive" fullWidth>{m.disconnectAll}</Button>
              </form>
            )}
            <form suppressHydrationWarning action={endManageAction} className={styles.form}>
              <Button type="submit" variant="secondary" fullWidth>{m.close}</Button>
            </form>
            <p className={styles.hint}>{m.sessionHint}</p>
          </>
        ) : (
          <>
            <p className={styles.lead}>{m.intro}</p>
            {loadError && !queryError && (
              <p className={`${styles.notice} ${styles.error}`} role="alert">
                {loadError === "expired_link" ? m.errExpired : connectErrorText(loadError, cc)}
              </p>
            )}
            {configured ? (
              <form suppressHydrationWarning action={startManageAction} className={styles.form}>
                <Button type="submit" fullWidth>{m.signIn}</Button>
              </form>
            ) : (
              <p className={`${styles.notice} ${styles.error}`}>{cc.notConfigured}</p>
            )}
            <p className={styles.hint}>{m.signInHint}</p>
            <p className={styles.hint}>{m.sharedNote}</p>
          </>
        )}
        <p className={styles.hint}>{cc.revokeHint}</p>
        <p className={styles.hint}>
          <Link href={`/datenschutz#${GOOGLE_CALENDAR_SECTION_ID}`} className={styles.link}>{cc.privacyLink}</Link>
        </p>
      </div>
      <PublicFooter />
    </main>
  );
}
