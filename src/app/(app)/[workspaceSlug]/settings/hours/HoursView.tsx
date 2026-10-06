"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button, Icon } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import type { TimeRange } from "@/features/workingHours/types";
import { saveBusinessHoursAction } from "@/server/actions/workingHours.actions";
import base from "../services/page.module.css";
import styles from "./page.module.css";

const DEFAULT_RANGE: TimeRange = { start: "09:00", end: "18:00" };
/** Display order Monday → Sunday; data index 0 = Sunday. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function HoursView({
  workspaceSlug,
  initialDays,
  messages,
  backLabel,
}: {
  workspaceSlug: string;
  initialDays: (TimeRange | null)[];
  messages: Messages["settingsHours"];
  backLabel: string;
}) {
  const [days, setDays] = useState<(TimeRange | null)[]>(initialDays);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function patchDay(index: number, range: TimeRange | null) {
    setSaved(false);
    setDays((current) => current.map((d, i) => (i === index ? range : d)));
  }

  function handleSave() {
    setError(null);
    setSaved(false);
    if (days.some((d) => d && d.end <= d.start)) {
      setError(messages.invalidRange);
      return;
    }
    startTransition(async () => {
      const result = await saveBusinessHoursAction(workspaceSlug, days);
      if (result.ok) setSaved(true);
      else setError(messages.errorGeneric);
    });
  }

  return (
    <main className={base.page}>
      <header className={base.header}>
        <Link href={`/${workspaceSlug}/settings`} className={base.backButton} aria-label={backLabel}>
          <Icon name="chevronRight" size={18} style={{ transform: "rotate(180deg)" }} />
        </Link>
        <div>
          <h1 className={base.title}>{messages.title}</h1>
          <p className={base.subtitle}>{messages.subtitle}</p>
        </div>
      </header>

      {error && <p className={base.error}>{error}</p>}
      {saved && <p className={styles.success}>{messages.saved}</p>}

      <div className={styles.list}>
        {DISPLAY_ORDER.map((index) => {
          const range = days[index] ?? null;
          return (
            <div key={index} className={styles.dayRow}>
              <span className={styles.dayName}>{messages.days[index]}</span>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={range !== null}
                  onChange={(event) => patchDay(index, event.target.checked ? DEFAULT_RANGE : null)}
                />
                {range ? messages.open : messages.closed}
              </label>
              {range && (
                <div className={styles.times}>
                  <span>{messages.from}</span>
                  <input
                    type="time"
                    className={styles.timeInput}
                    value={range.start}
                    onChange={(event) => patchDay(index, { ...range, start: event.target.value })}
                  />
                  <span>{messages.to}</span>
                  <input
                    type="time"
                    className={styles.timeInput}
                    value={range.end}
                    onChange={(event) => patchDay(index, { ...range, end: event.target.value })}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Button type="button" onClick={handleSave} disabled={isPending}>
        {messages.save}
      </Button>
    </main>
  );
}
