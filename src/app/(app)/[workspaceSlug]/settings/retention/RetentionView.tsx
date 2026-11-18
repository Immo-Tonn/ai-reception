"use client";

import { useCallback, useState, useTransition } from "react";
import { Button, SaveStatus, type SaveState } from "@/components/ui";
import { updateClientRetentionMonthsAction } from "@/server/actions/retentionSettings.actions";
import type { RetentionSettings } from "@/server/services/retentionSettings.service";
import type { Messages } from "@/lib/i18n";
import { SettingsHeader } from "../SettingsHeader";
import { schedulingErrorText } from "../schedulingErrors";
import { useUnsavedGuard } from "../useUnsavedGuard";
import styles from "../scheduling.module.css";

/**
 * Client data retention period (GDPR stage 4). Keeps three things apart:
 * the recommended period (provisional), the period this business chose, and
 * what actually runs (automatic anonymisation: off). Only the owner may change
 * the value; the action and the database check it again.
 */
export function RetentionView({
  workspaceSlug,
  initial,
  readOnly,
  messages,
  errors,
  backLabel,
  statusLabels,
}: {
  workspaceSlug: string;
  initial: RetentionSettings;
  readOnly: boolean;
  messages: Messages["retentionSettings"];
  errors: Messages["repositoryErrors"];
  backLabel: string;
  statusLabels: { unsaved: string; saving: string; saved: string };
}) {
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(String(initial.clientRetentionMonths));
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const locked = readOnly || !saved.canEdit;
  const months = value.trim() === "" ? NaN : Number(value);
  const valid = Number.isInteger(months) && months >= saved.minMonths && months <= saved.maxMonths;
  const dirty = !locked && months !== saved.clientRetentionMonths;
  useUnsavedGuard(dirty);
  const expire = useCallback(() => setJustSaved(false), []);
  const status: SaveState = pending ? "saving" : error ? "error" : justSaved && !dirty ? "saved" : dirty ? "dirty" : "idle";
  const invalidText = messages.errorInvalid.replace("{min}", String(saved.minMonths)).replace("{max}", String(saved.maxMonths));

  function save() {
    if (!dirty || pending) return;
    if (!valid) {
      setError(invalidText);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateClientRetentionMonthsAction(workspaceSlug, months);
      if (result.ok) {
        setSaved(result.data);
        setValue(String(result.data.clientRetentionMonths));
        setJustSaved(true);
      } else {
        setError(result.code === "invalid_input" ? invalidText : schedulingErrorText(result.code, errors));
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
        businessName={saved.businessName}
        backLabel={backLabel}
        dirty={dirty}
        discard={messages}
      />
      {readOnly && <p className={styles.notice}>{messages.demoNote}</p>}

      <div className={styles.fieldset} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{messages.recommendedTitle}</h2>
          <p className={styles.checkLabel}>{messages.monthsValue.replace("{n}", String(saved.recommendedMonths))}</p>
          <p className={styles.hint}>{messages.recommendedNote}</p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{messages.selectedTitle}</h2>
          <label className={styles.field}>
            <span>{messages.monthsLabel}</span>
            <input
              suppressHydrationWarning
              className={styles.number}
              type="number"
              inputMode="numeric"
              min={saved.minMonths}
              max={saved.maxMonths}
              step={1}
              disabled={locked || pending}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setJustSaved(false);
                setError(null);
              }}
            />
          </label>
          <p className={styles.hint}>
            {messages.rangeHint.replace("{min}", String(saved.minMonths)).replace("{max}", String(saved.maxMonths))}
          </p>
          {!readOnly && !saved.canEdit && <p className={styles.hint}>{messages.readOnlyNote}</p>}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{messages.statusTitle}</h2>
          <p className={styles.checkLabel}>{messages.statusOff}</p>
          <p className={styles.hint}>{messages.explain}</p>
        </section>
      </div>

      {!locked && (
        <div className={styles.saveBar}>
          <SaveStatus state={status} labels={{ ...statusLabels, saved: messages.saved }} error={error} onSavedExpire={expire} />
          <Button fullWidth onClick={save} disabled={!dirty || pending}>
            {pending ? statusLabels.saving : messages.save}
          </Button>
        </div>
      )}
    </main>
  );
}
