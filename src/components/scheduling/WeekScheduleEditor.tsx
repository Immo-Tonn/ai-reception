"use client";

import { useState } from "react";
import type { WeeklyIntervals } from "@/features/scheduling/types";
import {
  DEFAULT_INTERVAL,
  MAX_INTERVALS_PER_DAY,
  WEEK_ORDER,
  copyDay,
  normalizeWeekly,
  validateWeekly,
  type WeeklyIssueCode,
} from "@/features/scheduling/weeklyEdit";
import styles from "./WeekScheduleEditor.module.css";

export interface WeekScheduleLabels {
  open: string;
  closed: string;
  addInterval: string;
  removeInterval: string;
  from: string;
  to: string;
  copyTo: string;
  copyWeekdays: string;
  copyAll: string;
  intervalHint: string;
  issueBadTime: string;
  issueEndNotAfterStart: string;
  issueOverlap: string;
  issueTooMany: string;
}

export function weekdayName(weekday: number, locale: string): string {
  // 2024-01-07 is a Sunday.
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + weekday)));
}

const issueKey: Record<WeeklyIssueCode, keyof WeekScheduleLabels> = {
  bad_weekday: "issueBadTime",
  bad_time: "issueBadTime",
  end_not_after_start: "issueEndNotAfterStart",
  overlap: "issueOverlap",
  too_many: "issueTooMany",
};

/** First problem of the whole week (day name + message) for the parent's save guard; null when valid. */
export function weekProblem(value: WeeklyIntervals, labels: WeekScheduleLabels, locale: string): string | null {
  const issue = validateWeekly(value);
  return issue ? `${weekdayName(issue.weekday, locale)}: ${labels[issueKey[issue.code]]}` : null;
}

/**
 * Weekly schedule editor shared by the business hours and per-staff custom hours:
 * several intervals per day, a closed toggle, copy-to-other-days. Validation uses the same pure
 * rules as the server (features/scheduling/weeklyEdit). `readOnly` renders a plain summary.
 */
export function WeekScheduleEditor({
  value,
  onChange,
  labels,
  locale,
  readOnly = false,
}: {
  value: WeeklyIntervals;
  onChange: (next: WeeklyIntervals) => void;
  labels: WeekScheduleLabels;
  locale: string;
  readOnly?: boolean;
}) {
  const week = normalizeWeekly(value);
  const [copyFrom, setCopyFrom] = useState<number | null>(null);

  const setDay = (day: number, list: { start: string; end: string }[]) => onChange({ ...week, [day]: list });

  return (
    <div className={styles.week}>
      {WEEK_ORDER.map((day) => {
        const list = week[day];
        const issue = validateWeekly({ [day]: list });
        return (
          <div key={day} className={styles.day}>
            <div className={styles.dayHead}>
              <span className={styles.dayName}>{weekdayName(day, locale)}</span>
              {readOnly ? (
                <span className={list.length ? undefined : styles.closedText}>
                  {list.length ? list.map((i) => `${i.start}–${i.end}`).join(", ") : labels.closed}
                </span>
              ) : (
                <label className={styles.toggle}>
                  <input
                    suppressHydrationWarning
                    type="checkbox"
                    checked={list.length > 0}
                    onChange={(e) => setDay(day, e.target.checked ? [{ ...DEFAULT_INTERVAL }] : [])}
                  />
                  <span>{list.length > 0 ? labels.open : labels.closed}</span>
                </label>
              )}
            </div>

            {!readOnly && list.length > 0 && (
              <>
                {list.map((interval, index) => (
                  <div key={index} className={styles.interval}>
                    <label className={styles.timeField}>
                      <span>{labels.from}</span>
                      <input
                        suppressHydrationWarning
                        className={styles.time}
                        type="time"
                        step={300}
                        value={interval.start}
                        onChange={(e) => setDay(day, list.map((x, i) => (i === index ? { ...x, start: e.target.value } : x)))}
                      />
                    </label>
                    <label className={styles.timeField}>
                      <span>{labels.to}</span>
                      <input
                        suppressHydrationWarning
                        className={styles.time}
                        type="time"
                        step={300}
                        value={interval.end}
                        onChange={(e) => setDay(day, list.map((x, i) => (i === index ? { ...x, end: e.target.value } : x)))}
                      />
                    </label>
                    {list.length > 1 && (
                      <button type="button" className={`${styles.small} ${styles.danger}`} onClick={() => setDay(day, list.filter((_, i) => i !== index))}>
                        {labels.removeInterval}
                      </button>
                    )}
                  </div>
                ))}
                {issue && <p className={styles.issue} role="alert">{labels[issueKey[issue.code]]}</p>}
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.small}
                    disabled={list.length >= MAX_INTERVALS_PER_DAY}
                    onClick={() => {
                      const last = list[list.length - 1];
                      const start = last && last.end < "21:00" ? last.end : "09:00";
                      const end = start < "20:00" ? `${String(Number(start.slice(0, 2)) + 1).padStart(2, "0")}:${start.slice(3)}` : "23:00";
                      setDay(day, [...list, { start, end }]);
                    }}
                  >
                    {labels.addInterval}
                  </button>
                  <button type="button" className={styles.small} aria-expanded={copyFrom === day} onClick={() => setCopyFrom(copyFrom === day ? null : day)}>
                    {labels.copyTo}
                  </button>
                  {copyFrom === day && (
                    <>
                      <button type="button" className={styles.small} onClick={() => { onChange(copyDay(week, day, [1, 2, 3, 4, 5])); setCopyFrom(null); }}>
                        {labels.copyWeekdays}
                      </button>
                      <button type="button" className={styles.small} onClick={() => { onChange(copyDay(week, day, [0, 1, 2, 3, 4, 5, 6])); setCopyFrom(null); }}>
                        {labels.copyAll}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
      {!readOnly && <p className={styles.closedText}>{labels.intervalHint}</p>}
    </div>
  );
}
