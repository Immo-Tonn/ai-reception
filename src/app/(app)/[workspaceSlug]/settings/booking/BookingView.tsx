"use client";

import { useCallback, useState, useTransition } from "react";
import { Button, SaveStatus, type SaveState } from "@/components/ui";
import { slotIntervalOptions, type BookingRules } from "@/features/scheduling/types";
import { updateBookingRulesAction } from "@/server/actions/bookingRules.actions";
import type { Messages } from "@/lib/i18n";
import { SettingsHeader } from "../SettingsHeader";
import { schedulingErrorText } from "../schedulingErrors";
import { useUnsavedGuard } from "../useUnsavedGuard";
import styles from "../scheduling.module.css";

type Unit = "minutes" | "hours" | "days";
const UNIT_MINUTES: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

/** Largest unit that divides the value evenly (so 1440 shows as "1 day"). */
function splitNotice(minutes: number): { amount: number; unit: Unit } {
  if (minutes > 0 && minutes % 1440 === 0) return { amount: minutes / 1440, unit: "days" };
  if (minutes > 0 && minutes % 60 === 0) return { amount: minutes / 60, unit: "hours" };
  return { amount: minutes, unit: "minutes" };
}

function exampleTimes(step: number): string {
  return [0, 1, 2].map((i) => {
    const t = 9 * 60 + i * step;
    return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  }).join(", ");
}

const intValue = (raw: string): number => (raw.trim() === "" ? NaN : Number(raw));

export function BookingView({
  workspaceSlug,
  businessName,
  initial,
  readOnly,
  messages,
  errors,
  backLabel,
  statusLabels,
}: {
  workspaceSlug: string;
  businessName: string;
  initial: BookingRules;
  readOnly: boolean;
  messages: Messages["bookingSettings"];
  errors: Messages["repositoryErrors"];
  backLabel: string;
  statusLabels: { unsaved: string; saving: string; saved: string };
}) {
  const [saved, setSaved] = useState(initial);
  const [rules, setRules] = useState(initial);
  const [notice, setNotice] = useState(() => splitNotice(initial.minNoticeMinutes));
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const noticeMinutes = Math.round(notice.amount * UNIT_MINUTES[notice.unit]);
  const current: BookingRules = { ...rules, minNoticeMinutes: noticeMinutes };
  const dirty = (Object.keys(saved) as (keyof BookingRules)[]).some((k) => current[k] !== saved[k]);
  const valid =
    Number.isInteger(noticeMinutes) && noticeMinutes >= 0 &&
    Number.isInteger(rules.maxHorizonDays) && rules.maxHorizonDays >= 1 && rules.maxHorizonDays <= 180 &&
    [rules.cancellationDeadlineHours, rules.rescheduleDeadlineHours].every((h) => Number.isInteger(h) && h >= 0 && h <= 720);
  const exceeds = valid && noticeMinutes >= rules.maxHorizonDays * 1440;
  useUnsavedGuard(dirty);
  const expire = useCallback(() => setJustSaved(false), []);
  const status: SaveState = pending ? "saving" : error ? "error" : justSaved && !dirty ? "saved" : dirty ? "dirty" : "idle";

  const change = (patch: Partial<BookingRules>) => { setRules((r) => ({ ...r, ...patch })); setJustSaved(false); setError(null); };

  function save() {
    if (!dirty || pending || !valid || exceeds) return;
    setError(null);
    startTransition(async () => {
      const result = await updateBookingRulesAction(workspaceSlug, current);
      if (result.ok) {
        setSaved(result.data);
        setRules(result.data);
        setNotice(splitNotice(result.data.minNoticeMinutes));
        setJustSaved(true);
      } else {
        setError(result.code === "invalid_input" ? messages.errorInvalid : schedulingErrorText(result.code, errors));
      }
    });
  }

  const num = (value: number) => (Number.isNaN(value) ? "" : String(value));

  return (
    <main className={styles.page}>
      <SettingsHeader
        workspaceSlug={workspaceSlug}
        title={messages.title}
        subtitle={messages.subtitle}
        businessLabel={messages.businessLabel}
        businessName={businessName}
        backLabel={backLabel}
        dirty={dirty}
        discard={messages}
      />
      {readOnly && <p className={styles.notice}>{messages.demoNote}</p>}

      <fieldset disabled={readOnly || pending} className={styles.fieldset} style={{ gap: "var(--space-4)" }}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{messages.autoConfirmTitle}</h2>
          <label className={styles.check}>
            <input suppressHydrationWarning type="checkbox" checked={rules.autoConfirm} onChange={(e) => change({ autoConfirm: e.target.checked })} />
            <span>
              <span className={styles.checkLabel}>{rules.autoConfirm ? messages.autoConfirmOn : messages.autoConfirmOff}</span>
            </span>
          </label>
          <p className={styles.hint}>{messages.pendingExplain}</p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{messages.noticeTitle}</h2>
          <div className={styles.twoCols}>
            <input
              suppressHydrationWarning
              className={styles.number}
              type="number"
              inputMode="numeric"
              min={0}
              aria-label={messages.noticeTitle}
              value={num(notice.amount)}
              onChange={(e) => { setNotice((n) => ({ ...n, amount: intValue(e.target.value) })); setJustSaved(false); setError(null); }}
            />
            <select
              suppressHydrationWarning
              className={styles.select}
              aria-label={messages.noticeTitle}
              value={notice.unit}
              onChange={(e) => { setNotice((n) => ({ ...n, unit: e.target.value as Unit })); setJustSaved(false); }}
            >
              <option value="minutes">{messages.unitMinutes}</option>
              <option value="hours">{messages.unitHours}</option>
              <option value="days">{messages.unitDays}</option>
            </select>
          </div>
          <p className={styles.hint}>{messages.noticeHint}</p>
          {exceeds && <p className={styles.notice} role="alert">{messages.noticeExceeds}</p>}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{messages.horizonTitle}</h2>
          <label className={styles.field}>
            <span>{messages.horizonLabel}</span>
            <input suppressHydrationWarning className={styles.number} type="number" inputMode="numeric" min={1} max={180} value={num(rules.maxHorizonDays)} onChange={(e) => change({ maxHorizonDays: intValue(e.target.value) })} />
          </label>
          <p className={styles.hint}>{messages.horizonHint}</p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{messages.slotTitle}</h2>
          <label className={styles.field}>
            <span>{messages.slotLabel}</span>
            <select suppressHydrationWarning className={styles.select} value={rules.slotIntervalMinutes} onChange={(e) => change({ slotIntervalMinutes: Number(e.target.value) })}>
              {slotIntervalOptions.map((n) => (
                <option key={n} value={n}>{messages.slotOption.replace("{n}", String(n))}</option>
              ))}
            </select>
          </label>
          <p className={styles.hint}>{messages.slotHint.replace("{n}", String(rules.slotIntervalMinutes)).replace("{example}", exampleTimes(rules.slotIntervalMinutes))}</p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{messages.cancelTitle}</h2>
          <label className={styles.field}>
            <span>{messages.cancelLabel}</span>
            <input suppressHydrationWarning className={styles.number} type="number" inputMode="numeric" min={0} max={720} value={num(rules.cancellationDeadlineHours)} onChange={(e) => change({ cancellationDeadlineHours: intValue(e.target.value) })} />
          </label>
          <label className={styles.field}>
            <span>{messages.rescheduleLabel}</span>
            <input suppressHydrationWarning className={styles.number} type="number" inputMode="numeric" min={0} max={720} value={num(rules.rescheduleDeadlineHours)} onChange={(e) => change({ rescheduleDeadlineHours: intValue(e.target.value) })} />
          </label>
          <p className={styles.hint}>{messages.deadlineHint}</p>
        </section>
      </fieldset>

      {!readOnly && (
        <div className={styles.saveBar}>
          <SaveStatus state={status} labels={{ ...statusLabels, saved: messages.saved }} error={error} onSavedExpire={expire} />
          <Button fullWidth onClick={save} disabled={!dirty || pending || !valid || exceeds}>
            {pending ? statusLabels.saving : messages.save}
          </Button>
        </div>
      )}
    </main>
  );
}
