"use client";

import { useCallback, useState, useTransition } from "react";
import { Button, Input, SaveStatus, type SaveState } from "@/components/ui";
import { WeekScheduleEditor, weekProblem } from "@/components/scheduling/WeekScheduleEditor";
import type { ScheduleMode, StaffRecord, TimeOffEntry, WeeklyIntervals } from "@/features/scheduling/types";
import { cloneWeekly, sameWeekly } from "@/features/scheduling/weeklyEdit";
import { staffColorTokens } from "@/server/validation/scheduling.schema";
import { createStaffAction, setStaffActiveAction, setStaffScheduleAction, updateStaffAction } from "@/server/actions/staff.actions";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Messages } from "@/lib/i18n";
import { SettingsHeader } from "../SettingsHeader";
import { TimeOffPanel } from "../TimeOffPanel";
import { schedulingErrorText } from "../schedulingErrors";
import { useUnsavedGuard } from "../useUnsavedGuard";
import styles from "../scheduling.module.css";

interface Form {
  name: string;
  title: string;
  colorToken: string;
  serviceIds: string[];
  mode: ScheduleMode;
  weekly: WeeklyIntervals;
}

const initials = (name: string) => [...name.trim()].slice(0, 2).join("").toUpperCase() || "?";
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function StaffView({
  workspaceSlug,
  businessName,
  initialStaff,
  services,
  businessWeekly,
  staffWeekly,
  initialTimeOff,
  readOnly,
  messages,
  hours,
  errors,
  backLabel,
  statusLabels,
  today,
}: {
  workspaceSlug: string;
  businessName: string;
  initialStaff: StaffRecord[];
  services: { id: string; name: string; active: boolean }[];
  businessWeekly: WeeklyIntervals;
  staffWeekly: Record<string, WeeklyIntervals>;
  initialTimeOff: TimeOffEntry[];
  readOnly: boolean;
  messages: Messages["staffSettings"];
  hours: Messages["hoursSettings"];
  errors: Messages["repositoryErrors"];
  backLabel: string;
  statusLabels: { unsaved: string; saving: string; saved: string };
  today: string;
}) {
  const { locale } = useI18n();
  const [staff, setStaff] = useState(initialStaff);
  const [weeklyMap, setWeeklyMap] = useState(staffWeekly);
  const [timeOff, setTimeOff] = useState(initialTimeOff);
  /** undefined = list, null = new person, string = editing that id. */
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [baseline, setBaseline] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [pending, startTransition] = useTransition();
  const expire = useCallback(() => setNotice(null), []);

  const errorText = (code: string) => schedulingErrorText(code, errors);
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? "";

  const formFor = (m: StaffRecord | null, weekly: Record<string, WeeklyIntervals>): Form => ({
    name: m?.name ?? "",
    title: m?.title ?? "",
    colorToken: m?.colorToken ?? staffColorTokens[staff.length % staffColorTokens.length],
    serviceIds: m?.serviceIds ?? [],
    mode: m?.scheduleMode ?? "inherit",
    weekly: cloneWeekly(m ? (weekly[m.id] ?? businessWeekly) : businessWeekly),
  });

  function open(member: StaffRecord | null, weekly = weeklyMap) {
    const f = formFor(member, weekly);
    setEditing(member ? member.id : null);
    setForm(f);
    setBaseline(f);
    setError(null);
    setConfirmOff(false);
  }

  function backToList() {
    setEditing(undefined);
    setForm(null);
    setBaseline(null);
    setError(null);
    setConfirmOff(false);
  }

  const member = typeof editing === "string" ? staff.find((s) => s.id === editing) : undefined;
  const scheduleChanged = Boolean(form && baseline && (form.mode !== baseline.mode || (form.mode === "custom" && !sameWeekly(form.weekly, baseline.weekly))));
  const basicsChanged = Boolean(form && baseline && (form.name !== baseline.name || form.title !== baseline.title || form.colorToken !== baseline.colorToken || !sameIds(form.serviceIds, baseline.serviceIds)));
  const dirty = Boolean(form && (editing === null ? form.name.trim() !== "" || form.serviceIds.length > 0 : basicsChanged || scheduleChanged));
  const problem = form && form.mode === "custom" ? weekProblem(form.weekly, hours, locale) : null;
  const canSave = Boolean(form && form.name.trim() && !problem && dirty && !pending);
  useUnsavedGuard(dirty);
  const status: SaveState = pending ? "saving" : error ? "error" : dirty ? "dirty" : notice ? "saved" : "idle";

  const patch = (p: Partial<Form>) => { setForm((f) => (f ? { ...f, ...p } : f)); setError(null); setNotice(null); };

  function save() {
    if (!form || !canSave) return;
    setError(null);
    startTransition(async () => {
      let current: StaffRecord | undefined = member;
      if (editing === null) {
        const r = await createStaffAction(workspaceSlug, { name: form.name, title: form.title, colorToken: form.colorToken as never, serviceIds: form.serviceIds });
        if (!r.ok) return setError(errorText(r.code));
        current = r.data;
      } else if (basicsChanged && current) {
        const r = await updateStaffAction(workspaceSlug, current.id, { name: form.name, title: form.title, colorToken: form.colorToken as never, serviceIds: form.serviceIds });
        if (!r.ok) return setError(errorText(r.code));
        current = r.data;
      }
      if (!current) return;
      const created = editing === null;
      let nextWeekly = weeklyMap;
      if (created ? form.mode === "custom" : scheduleChanged) {
        const r = await setStaffScheduleAction(workspaceSlug, current.id, form.mode === "custom" ? { mode: "custom", weekly: form.weekly } : { mode: "inherit" });
        if (!r.ok) {
          // Basics were saved; keep the person in the list and stay on the form with the error.
          setStaff((list) => (created ? [...list, current!] : list.map((s) => (s.id === current!.id ? current! : s))));
          setEditing(current.id);
          return setError(r.code === "invalid_input" ? hours.errorInvalid : errorText(r.code));
        }
        current = r.data;
        if (form.mode === "custom") nextWeekly = { ...weeklyMap, [current.id]: cloneWeekly(form.weekly) };
        setWeeklyMap(nextWeekly);
      }
      const saved = current;
      setStaff((list) => (created ? [...list, saved] : list.map((s) => (s.id === saved.id ? saved : s))));
      open(saved, nextWeekly);
      setNotice(created ? messages.created : messages.saved);
    });
  }

  function setActive(m: StaffRecord, active: boolean) {
    setError(null);
    startTransition(async () => {
      const r = await setStaffActiveAction(workspaceSlug, m.id, active);
      if (!r.ok) return setError(errorText(r.code));
      setStaff((list) => list.map((s) => (s.id === m.id ? r.data : s)));
      setConfirmOff(false);
      setNotice(active ? messages.reactivated : messages.deactivated);
      if (editing === m.id) backToList();
    });
  }

  const row = (m: StaffRecord) => (
    <li key={m.id} className={styles.row}>
      <span className={styles.avatar} style={{ background: `var(${m.colorToken})`, opacity: m.active ? 1 : 0.5 }} aria-hidden="true">{initials(m.name)}</span>
      <div className={styles.rowBody}>
        <p className={styles.rowLabel}>
          {m.name}
          {!m.active && <span className={styles.badge}>{messages.inactiveBadge}</span>}
        </p>
        {m.title && <p className={styles.rowMeta}>{m.title}</p>}
        <div className={styles.chips}>
          {m.serviceIds.length === 0 ? <span className={styles.chip}>{messages.noServicesAssigned}</span> : m.serviceIds.map((id) => <span key={id} className={styles.chip}>{serviceName(id)}</span>)}
        </div>
      </div>
      <button type="button" className={styles.textButton} onClick={() => open(m)} disabled={pending}>{messages.edit}</button>
      {!readOnly && !m.active && <button type="button" className={styles.textButton} onClick={() => setActive(m, true)} disabled={pending}>{messages.reactivate}</button>}
    </li>
  );

  const activeStaff = staff.filter((s) => s.active);
  const inactiveStaff = staff.filter((s) => !s.active);

  return (
    <main className={styles.page}>
      <SettingsHeader
        workspaceSlug={workspaceSlug}
        title={form ? (editing === null ? messages.newTitle : messages.editTitle) : messages.title}
        subtitle={form ? undefined : messages.subtitle}
        businessLabel={hours.businessLabel}
        businessName={businessName}
        backLabel={backLabel}
        dirty={dirty}
        onBack={form ? backToList : undefined}
        discard={hours}
      />
      {readOnly && <p className={styles.notice}>{hours.demoNote}</p>}

      {!form && (
        <>
          <SaveStatus state={error ? "error" : notice ? "saved" : "idle"} labels={{ ...statusLabels, saved: notice ?? statusLabels.saved }} error={error} onSavedExpire={expire} />
          {activeStaff.length === 0 && <p className={styles.empty}>{messages.empty}</p>}
          {activeStaff.length > 0 && <ul className={styles.list}>{activeStaff.map(row)}</ul>}
          {!readOnly && <Button variant="secondary" onClick={() => open(null)}>{messages.addButton}</Button>}
          {inactiveStaff.length > 0 && (
            <section style={{ marginTop: "var(--space-6)" }}>
              <h2 className={styles.sectionTitle}>{messages.inactiveSection}</h2>
              <ul className={styles.list}>{inactiveStaff.map(row)}</ul>
            </section>
          )}
        </>
      )}

      {form && (
        <>
          <fieldset disabled={readOnly || pending} className={styles.fieldset} style={{ gap: "var(--space-5, 20px)" }}>
            <Input label={messages.nameLabel} value={form.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })} error={!form.name.trim() && dirty ? messages.nameRequired : undefined} />
            <Input label={messages.titleLabel} placeholder={messages.titlePlaceholder} value={form.title} maxLength={80} onChange={(e) => patch({ title: e.target.value })} />

            <div className={styles.fieldset}>
              <span className={styles.legend}>{messages.colorLabel}</span>
              <div className={styles.swatches} role="radiogroup" aria-label={messages.colorLabel}>
                {staffColorTokens.map((token) => (
                  <button
                    key={token}
                    type="button"
                    role="radio"
                    aria-checked={form.colorToken === token}
                    aria-label={token.replace("--color-accent-", "")}
                    className={`${styles.swatch} ${form.colorToken === token ? styles.swatchOn : ""}`}
                    style={{ background: `var(${token})` }}
                    onClick={() => patch({ colorToken: token })}
                  />
                ))}
              </div>
            </div>

            <div className={styles.fieldset}>
              <span className={styles.legend}>{messages.servicesLabel}</span>
              {services.length === 0 ? (
                <p className={styles.hint}>{messages.noServices}</p>
              ) : (
                services.map((s) => (
                  <label key={s.id} className={styles.check}>
                    <input
                      suppressHydrationWarning
                      type="checkbox"
                      checked={form.serviceIds.includes(s.id)}
                      onChange={() => patch({ serviceIds: form.serviceIds.includes(s.id) ? form.serviceIds.filter((x) => x !== s.id) : [...form.serviceIds, s.id] })}
                    />
                    <span>{s.name}</span>
                  </label>
                ))
              )}
              <p className={styles.hint}>{messages.servicesHint}</p>
            </div>

            <div className={styles.fieldset}>
              <span className={styles.legend}>{messages.scheduleLabel}</span>
              <label className={styles.radio}>
                <input suppressHydrationWarning type="radio" name="mode" checked={form.mode === "inherit"} onChange={() => patch({ mode: "inherit" })} />
                <span><span className={styles.checkLabel}>{messages.scheduleInherit}</span><span className={styles.hint}>{messages.scheduleInheritHint}</span></span>
              </label>
              <label className={styles.radio}>
                <input suppressHydrationWarning type="radio" name="mode" checked={form.mode === "custom"} onChange={() => patch({ mode: "custom" })} />
                <span><span className={styles.checkLabel}>{messages.scheduleCustom}</span><span className={styles.hint}>{messages.scheduleCustomHint}</span></span>
              </label>
              {form.mode === "custom" && (
                <>
                  {!readOnly && (
                    <button type="button" className={styles.textButton} onClick={() => patch({ weekly: cloneWeekly(businessWeekly) })}>{messages.copyBusiness}</button>
                  )}
                  <WeekScheduleEditor value={form.weekly} onChange={(weekly) => patch({ weekly })} labels={hours} locale={locale} readOnly={readOnly} />
                  {problem && <p className={styles.notice} role="alert">{problem}</p>}
                </>
              )}
            </div>
          </fieldset>

          {!readOnly && (
            <div className={styles.saveBar}>
              <SaveStatus state={status} labels={{ ...statusLabels, saved: notice ?? statusLabels.saved }} error={error} onSavedExpire={expire} />
              <Button fullWidth onClick={save} disabled={!canSave}>{pending ? statusLabels.saving : messages.save}</Button>
            </div>
          )}

          <section className={styles.section} style={{ marginTop: "var(--space-6)" }}>
            <h2 className={styles.sectionTitle}>{messages.timeOffTitle}</h2>
            {member ? (
              <TimeOffPanel
                workspaceSlug={workspaceSlug}
                staffId={member.id}
                entries={timeOff}
                onChange={setTimeOff}
                addLabel={hours.addTimeOff}
                emptyLabel={messages.timeOffEmpty}
                labels={hours}
                errorText={errorText}
                locale={locale}
                today={today}
                readOnly={readOnly}
              />
            ) : (
              <p className={styles.hint}>{messages.saveFirst}</p>
            )}
          </section>

          {!readOnly && member && (
            <section className={styles.section}>
              {member.active ? (
                confirmOff ? (
                  <div className={styles.confirm} role="alertdialog" aria-label={messages.deactivateTitle.replace("{name}", member.name)}>
                    <p className={styles.confirmTitle}>{messages.deactivateTitle.replace("{name}", member.name)}</p>
                    <p>{messages.deactivateText}</p>
                    <div className={styles.actions}>
                      <Button variant="secondary" onClick={() => setConfirmOff(false)} disabled={pending}>{hours.keep}</Button>
                      <Button onClick={() => setActive(member, false)} disabled={pending}>{messages.deactivateYes}</Button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className={`${styles.textButton} ${styles.dangerButton}`} onClick={() => setConfirmOff(true)} disabled={pending}>{messages.deactivate}</button>
                )
              ) : (
                <button type="button" className={styles.textButton} onClick={() => setActive(member, true)} disabled={pending}>{messages.reactivate}</button>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
