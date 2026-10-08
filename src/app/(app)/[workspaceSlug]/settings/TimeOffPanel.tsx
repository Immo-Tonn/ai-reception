"use client";

import { useCallback, useState, useTransition } from "react";
import { Button, Input, SaveStatus } from "@/components/ui";
import type { TimeOffEntry } from "@/features/scheduling/types";
import { createTimeOffAction, deleteTimeOffAction } from "@/server/actions/workingHours.actions";
import type { Messages } from "@/lib/i18n";
import styles from "./scheduling.module.css";

type Labels = Messages["hoursSettings"];

function formatDate(date: string, locale: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Time off of ONE owner (`staffId` null = business closures): list, add (full days or one partial day),
 * delete with an in-page confirm. Persists immediately through server actions (one audit entry each).
 */
export function TimeOffPanel({
  workspaceSlug,
  staffId,
  entries,
  onChange,
  addLabel,
  emptyLabel,
  labels,
  errorText,
  locale,
  today,
  readOnly = false,
}: {
  workspaceSlug: string;
  staffId: string | null;
  entries: TimeOffEntry[];
  onChange: (next: TimeOffEntry[]) => void;
  addLabel: string;
  emptyLabel: string;
  labels: Labels;
  errorText: (code: string) => string;
  locale: string;
  today: string;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [partial, setPartial] = useState(false);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const expire = useCallback(() => setNotice(null), []);

  const mine = entries.filter((e) => e.staffId === staffId);
  const upcoming = mine.filter((e) => e.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = mine.filter((e) => e.endDate < today).sort((a, b) => b.startDate.localeCompare(a.startDate));

  function add() {
    setError(null);
    start(async () => {
      const result = await createTimeOffAction(workspaceSlug, {
        staffId,
        startDate,
        endDate: partial ? startDate : endDate,
        startTime: partial ? startTime : null,
        endTime: partial ? endTime : null,
        reason,
      });
      if (!result.ok) return setError(result.code === "invalid_input" ? labels.errorInvalid : errorText(result.code));
      onChange([...entries, result.data]);
      setNotice(labels.added);
      setOpen(false);
      setReason("");
    });
  }

  function remove(id: string) {
    setError(null);
    start(async () => {
      const result = await deleteTimeOffAction(workspaceSlug, id);
      if (!result.ok) return setError(errorText(result.code));
      onChange(entries.filter((e) => e.id !== id));
      setRemoving(null);
      setNotice(labels.removed);
    });
  }

  const render = (e: TimeOffEntry) => (
    <li key={e.id} className={styles.row}>
      <div className={styles.rowBody}>
        <p className={styles.rowLabel}>
          {e.startDate === e.endDate ? formatDate(e.startDate, locale) : `${formatDate(e.startDate, locale)} – ${formatDate(e.endDate, locale)}`}
        </p>
        <p className={styles.rowMeta}>
          {e.startTime && e.endTime ? `${e.startTime}–${e.endTime}` : labels.allDay}
          {e.reason ? ` · ${e.reason}` : ""}
        </p>
        {removing === e.id && (
          <div className={styles.confirm} role="alertdialog" aria-label={labels.removeConfirm}>
            <p>{labels.removeConfirm}</p>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => setRemoving(null)} disabled={pending}>{labels.keep}</Button>
              <Button onClick={() => remove(e.id)} disabled={pending}>{labels.removeYes}</Button>
            </div>
          </div>
        )}
      </div>
      {!readOnly && removing !== e.id && (
        <button type="button" className={`${styles.textButton} ${styles.dangerButton}`} onClick={() => setRemoving(e.id)} disabled={pending}>
          {labels.remove}
        </button>
      )}
    </li>
  );

  return (
    <div className={styles.fieldset}>
      <SaveStatus
        state={pending ? "saving" : error ? "error" : notice ? "saved" : "idle"}
        labels={{ unsaved: "", saving: "…", saved: notice ?? "" }}
        error={error}
        onSavedExpire={expire}
      />
      {mine.length === 0 && <p className={styles.empty}>{emptyLabel}</p>}
      {upcoming.length > 0 && (
        <>
          <p className={styles.legend}>{labels.upcoming}</p>
          <ul className={styles.list}>{upcoming.map(render)}</ul>
        </>
      )}
      {past.length > 0 && (
        <>
          <p className={styles.legend}>{labels.past}</p>
          <ul className={styles.list}>{past.map(render)}</ul>
        </>
      )}
      {!readOnly && !open && (
        <Button variant="secondary" onClick={() => setOpen(true)}>{addLabel}</Button>
      )}
      {!readOnly && open && (
        <div className={styles.form}>
          <div className={styles.twoCols}>
            <Input label={labels.fromDate} type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }} />
            {!partial && <Input label={labels.toDate} type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />}
          </div>
          <label className={styles.check}>
            <input suppressHydrationWarning type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} />
            <span>{labels.partialDay}</span>
          </label>
          {partial && (
            <div className={styles.twoCols}>
              <Input label={labels.from} type="time" step={300} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              <Input label={labels.to} type="time" step={300} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          )}
          <Input label={labels.reasonLabel} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          <span className={styles.hint}>{labels.reasonHint}</span>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => { setOpen(false); setError(null); }} disabled={pending}>{labels.cancel}</Button>
            <Button onClick={add} disabled={pending || !startDate || (!partial && !endDate)}>{labels.add}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
