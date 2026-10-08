"use client";

import { useCallback, useState, useTransition } from "react";
import { Button, SaveStatus, type SaveState } from "@/components/ui";
import { WeekScheduleEditor, weekProblem } from "@/components/scheduling/WeekScheduleEditor";
import type { TimeOffEntry, WeeklyIntervals } from "@/features/scheduling/types";
import { sameWeekly } from "@/features/scheduling/weeklyEdit";
import { replaceBusinessHoursAction } from "@/server/actions/workingHours.actions";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Messages } from "@/lib/i18n";
import { SettingsHeader } from "../SettingsHeader";
import { TimeOffPanel } from "../TimeOffPanel";
import { schedulingErrorText } from "../schedulingErrors";
import { useUnsavedGuard } from "../useUnsavedGuard";
import styles from "../scheduling.module.css";

export function HoursView({
  workspaceSlug,
  businessName,
  initialWeekly,
  initialClosures,
  readOnly,
  messages,
  errors,
  backLabel,
  statusLabels,
  today,
}: {
  workspaceSlug: string;
  businessName: string;
  initialWeekly: WeeklyIntervals;
  initialClosures: TimeOffEntry[];
  readOnly: boolean;
  messages: Messages["hoursSettings"];
  errors: Messages["repositoryErrors"];
  backLabel: string;
  statusLabels: { unsaved: string; saving: string; saved: string };
  today: string;
}) {
  const { locale } = useI18n();
  const [saved, setSaved] = useState(initialWeekly);
  const [weekly, setWeekly] = useState(initialWeekly);
  const [closures, setClosures] = useState(initialClosures);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = !sameWeekly(weekly, saved);
  const problem = weekProblem(weekly, messages, locale);
  useUnsavedGuard(dirty);
  const expire = useCallback(() => setJustSaved(false), []);
  const status: SaveState = pending ? "saving" : error ? "error" : justSaved && !dirty ? "saved" : dirty ? "dirty" : "idle";

  function save() {
    if (!dirty || pending || problem) return;
    setError(null);
    startTransition(async () => {
      const result = await replaceBusinessHoursAction(workspaceSlug, weekly);
      if (result.ok) {
        setSaved(result.data);
        setWeekly(result.data);
        setJustSaved(true);
      } else {
        setError(result.code === "invalid_input" ? messages.errorInvalid : schedulingErrorText(result.code, errors));
      }
    });
  }

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

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{messages.weekTitle}</h2>
        <WeekScheduleEditor value={weekly} onChange={(next) => { setWeekly(next); setJustSaved(false); setError(null); }} labels={messages} locale={locale} readOnly={readOnly} />
        {problem && !readOnly && <p className={styles.notice} role="alert">{problem}</p>}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{messages.closuresTitle}</h2>
        <p className={styles.hint}>{messages.closuresHint}</p>
        <TimeOffPanel
          workspaceSlug={workspaceSlug}
          staffId={null}
          entries={closures}
          onChange={setClosures}
          addLabel={messages.addClosure}
          emptyLabel={messages.closuresEmpty}
          labels={messages}
          errorText={(code) => schedulingErrorText(code, errors)}
          locale={locale}
          today={today}
          readOnly={readOnly}
        />
      </section>

      {!readOnly && (
        <div className={styles.saveBar}>
          <SaveStatus state={status} labels={{ ...statusLabels, saved: messages.saved }} error={error} onSavedExpire={expire} />
          <Button fullWidth onClick={save} disabled={!dirty || pending || Boolean(problem)}>
            {pending ? statusLabels.saving : messages.save}
          </Button>
        </div>
      )}
    </main>
  );
}
