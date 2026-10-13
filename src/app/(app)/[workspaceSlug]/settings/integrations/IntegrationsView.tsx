"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { GOOGLE_CALENDAR_SECTION_ID } from "@/content/legal/googleCalendarPrivacy";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import type { Locale, Messages } from "@/lib/i18n";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import type { ExternalCalendarConnectionSummary, ExternalCalendarErrorCode } from "@/features/externalCalendar/types";
import type { CalendarSettingsData } from "@/server/services/externalCalendarSettings.service";
import {
  createCalendarConnectLinkAction,
  disconnectCalendarAction,
  refreshCalendarAction,
  type CalendarActionCode,
} from "@/server/actions/externalCalendar.actions";
import { SettingsHeader } from "../SettingsHeader";
import styles from "../scheduling.module.css";
import own from "./integrations.module.css";

type M = Messages["calendarIntegration"];

function statusText(c: ExternalCalendarConnectionSummary | undefined, m: M): string {
  if (!c) return m.statusNotConnected;
  if (c.status === "revoked") return m.statusRevoked;
  if (c.status === "error") return m.statusError;
  return m.statusConnected;
}

function errorDetail(code: ExternalCalendarErrorCode | null, m: M): string | null {
  switch (code) {
    case "unavailable":
      return m.errUnavailable;
    case "rate_limited":
      return m.errRateLimited;
    case "calendar_not_found":
      return m.errCalendarNotFound;
    case "invalid_response":
      return m.errInvalidResponse;
    case "not_configured":
      return m.errNotConfigured;
    case "revoked":
      return m.errRevoked;
    default:
      return null;
  }
}

function actionError(code: CalendarActionCode, m: M): string {
  if (code === "forbidden") return m.errorForbidden;
  if (code === "not_found") return m.errorNotFound;
  if (code === "not_configured") return m.notConfigured;
  return m.errorGeneric;
}

export function IntegrationsView({
  workspaceSlug,
  businessName,
  locale,
  demo,
  forbidden,
  data,
  messages: m,
  backLabel,
  discard,
}: {
  workspaceSlug: string;
  businessName: string;
  locale: Locale;
  demo: boolean;
  forbidden: boolean;
  data: CalendarSettingsData | null;
  messages: M;
  backLabel: string;
  discard: { discardTitle: string; discardText: string; discard: string; keepEditing: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyStaff, setBusyStaff] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, { url: string; expiresAt: string }>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const connections = new Map((data?.overview.connections ?? []).map((c) => [c.staffId, c]));
  const configured = data?.overview.configured ?? false;

  const act = (staffId: string, fn: () => Promise<void>) => {
    setBusyStaff(staffId);
    setErrors((e) => ({ ...e, [staffId]: "" }));
    startTransition(async () => {
      try {
        await fn();
      } finally {
        setBusyStaff(null);
      }
    });
  };

  const createLink = (staffId: string, openNow: boolean) =>
    act(staffId, async () => {
      const r = await createCalendarConnectLinkAction(workspaceSlug, staffId);
      if (!r.ok) {
        setErrors((e) => ({ ...e, [staffId]: actionError(r.code, m) }));
        return;
      }
      if (openNow) window.location.assign(r.data.url);
      else setLinks((l) => ({ ...l, [staffId]: r.data }));
    });

  const refresh = (staffId: string) =>
    act(staffId, async () => {
      const r = await refreshCalendarAction(workspaceSlug, staffId);
      if (!r.ok) setErrors((e) => ({ ...e, [staffId]: actionError(r.code, m) }));
      router.refresh();
    });

  const disconnect = (staffId: string) =>
    act(staffId, async () => {
      const r = await disconnectCalendarAction(workspaceSlug, staffId);
      setConfirming(null);
      if (!r.ok) setErrors((e) => ({ ...e, [staffId]: actionError(r.code, m) }));
      router.refresh();
    });

  const copy = async (staffId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(staffId);
      setTimeout(() => setCopied((c) => (c === staffId ? null : c)), 2000);
    } catch {
      // Clipboard blocked: the link stays selectable in the field.
    }
  };

  return (
    <main className={styles.page}>
      <SettingsHeader
        workspaceSlug={workspaceSlug}
        title={m.title}
        subtitle={m.subtitle}
        businessLabel={m.businessLabel}
        businessName={businessName}
        backLabel={backLabel}
        dirty={false}
        discard={discard}
      />

      <section className={styles.section} aria-labelledby="gcal-privacy">
        <h2 id="gcal-privacy" className={styles.sectionTitle}>{m.privacyTitle}</h2>
        <ul className={own.points}>
          <li>{m.privacy1}</li>
          <li>{m.privacy2}</li>
          <li>{m.privacy3}</li>
          <li>{m.privacy4}</li>
        </ul>
        <p className={styles.hint}>{m.privacyPurpose}</p>
        <p className={styles.hint}>{m.manageHint}</p>
        <p className={styles.hint}>
          <Link href={`/datenschutz#${GOOGLE_CALENDAR_SECTION_ID}`} className={own.link}>{m.privacyLink}</Link>
        </p>
      </section>

      {demo && <p className={styles.notice}>{m.demoNote}</p>}
      {forbidden && <p className={styles.notice} role="alert">{m.errorForbidden}</p>}
      {data && !configured && <p className={styles.notice}>{m.notConfigured}</p>}

      {data && (
        <section className={styles.section} aria-labelledby="gcal-staff">
          <h2 id="gcal-staff" className={styles.sectionTitle}>{m.staffTitle}</h2>
          {data.staff.length === 0 ? (
            <p className={styles.empty}>{m.noStaff}</p>
          ) : (
            <ul className={styles.list}>
              {data.staff.map((s) => {
                const c = connections.get(s.id);
                const isOwn = s.id === data.overview.ownStaffId;
                const detail = c && c.status !== "connected" ? errorDetail(c.lastErrorCode ?? (c.status === "revoked" ? "revoked" : null), m) : null;
                const link = links[s.id];
                const working = pending && busyStaff === s.id;
                return (
                  <li key={s.id} className={own.item}>
                    <div className={own.itemHead}>
                      <p className={styles.rowLabel}>
                        <span className={own.name}>{s.name}{isOwn ? ` (${m.you})` : ""}</span>
                        <span className={`${styles.badge} ${c ? (c.status === "connected" ? own.ok : own.bad) : ""}`}>{statusText(c, m)}</span>
                      </p>
                      {c && (
                        <p className={styles.rowMeta} suppressHydrationWarning>
                          {c.lastSuccessAt ? m.lastCheck.replace("{time}", formatDateTime(new Date(c.lastSuccessAt), locale)) : m.neverChecked}
                          {" · "}
                          {m.calendarsCount.replace("{n}", String(c.calendarCount))}
                        </p>
                      )}
                      {detail && <p className={own.warn}>{detail}</p>}
                      {c && c.status !== "connected" && <p className={styles.rowMeta}>{m.unconfirmedHint}</p>}
                    </div>

                    {configured && (
                      <div className={styles.actions}>
                        {isOwn && (
                          <Button size="sm" onClick={() => createLink(s.id, true)} disabled={working}>
                            {c ? m.reconnect : m.connectOwn}
                          </Button>
                        )}
                        <Button size="sm" variant="secondary" onClick={() => createLink(s.id, false)} disabled={working}>
                          {c ? m.reconnect : m.createLink}
                        </Button>
                        {c && (
                          <Button size="sm" variant="secondary" onClick={() => refresh(s.id)} disabled={working}>
                            {m.checkNow}
                          </Button>
                        )}
                        {c && (
                          <button type="button" className={`${styles.textButton} ${styles.dangerButton}`} onClick={() => setConfirming(s.id)} disabled={working}>
                            {m.disconnect}
                          </button>
                        )}
                      </div>
                    )}

                    {confirming === s.id && (
                      <div className={styles.confirm} role="alertdialog" aria-label={m.disconnectTitle}>
                        <p className={styles.confirmTitle}>{m.disconnectTitle}</p>
                        <p>{m.disconnectText}</p>
                        <div className={styles.actions}>
                          <Button size="sm" variant="destructive" onClick={() => disconnect(s.id)} disabled={working}>{m.disconnect}</Button>
                          <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>{m.cancel}</Button>
                        </div>
                      </div>
                    )}

                    {link && (
                      <div className={own.linkBox}>
                        <p className={styles.confirmTitle}>{m.linkTitle.replace("{name}", s.name)}</p>
                        <input suppressHydrationWarning className={own.linkField} readOnly value={link.url} aria-label={m.linkTitle.replace("{name}", s.name)} onFocus={(e) => e.currentTarget.select()} />
                        <div className={styles.actions}>
                          <Button size="sm" variant="secondary" onClick={() => copy(s.id, link.url)}>{copied === s.id ? m.copied : m.copy}</Button>
                        </div>
                        <p className={styles.rowMeta} suppressHydrationWarning>
                          {m.linkHint.replace(/\{name\}/g, s.name).replace("{date}", formatDate(new Date(link.expiresAt), locale, { dateStyle: "medium", timeStyle: "short" }))}
                        </p>
                      </div>
                    )}

                    {errors[s.id] && <p className={own.warn} role="alert">{errors[s.id]}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {data?.overview.managesAll && data.overview.connections.length > 0 && (
        <section className={styles.section} aria-labelledby="gcal-conflicts">
          <h2 id="gcal-conflicts" className={styles.sectionTitle}>{m.conflictsTitle}</h2>
          {data.conflicts.length === 0 ? (
            <p className={styles.empty}>{m.noConflicts}</p>
          ) : (
            <>
              <p className={styles.hint}>{m.conflictsIntro}</p>
              <ul className={styles.list}>
                {data.conflicts.map((c) => (
                  <li key={c.appointmentId} className={styles.row}>
                    <div className={styles.rowBody}>
                      <p className={styles.rowLabel} suppressHydrationWarning>
                        {formatDate(new Date(`${c.date}T12:00:00`), locale, { weekday: "short", day: "numeric", month: "short" })} · {c.time}
                      </p>
                      <p className={styles.rowMeta}>{c.staffName} · {c.service ?? m.privateAppointment}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </main>
  );
}
