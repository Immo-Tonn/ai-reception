"use client";

import { useCallback, useState, useTransition } from "react";
import { Button, Input, SaveStatus, type SaveState } from "@/components/ui";
import type { ResourceRecord } from "@/features/scheduling/types";
import { resourceTypes } from "@/server/validation/scheduling.schema";
import { createResourceAction, setResourceActiveAction, updateResourceAction } from "@/server/actions/resources.actions";
import type { Messages } from "@/lib/i18n";
import { SettingsHeader } from "../SettingsHeader";
import { schedulingErrorText } from "../schedulingErrors";
import { useUnsavedGuard } from "../useUnsavedGuard";
import styles from "../scheduling.module.css";

interface Form {
  name: string;
  type: string;
  description: string;
  serviceIds: string[];
}
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function ResourcesView({
  workspaceSlug,
  businessName,
  initialResources,
  services,
  readOnly,
  messages,
  hours,
  errors,
  backLabel,
  statusLabels,
}: {
  workspaceSlug: string;
  businessName: string;
  initialResources: ResourceRecord[];
  services: { id: string; name: string }[];
  readOnly: boolean;
  messages: Messages["resourcesSettings"];
  hours: Messages["hoursSettings"];
  errors: Messages["repositoryErrors"];
  backLabel: string;
  statusLabels: { unsaved: string; saving: string; saved: string };
}) {
  const [resources, setResources] = useState(initialResources);
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [baseline, setBaseline] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [pending, startTransition] = useTransition();
  const expire = useCallback(() => setNotice(null), []);

  const typeLabels: Record<string, string> = { room: messages.typeRoom, vehicle: messages.typeVehicle, equipment: messages.typeEquipment, custom: messages.typeCustom };
  const typeName = (t: string) => typeLabels[t] ?? t;
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? "";
  const errorText = (code: string) => (code === "conflict" ? messages.errorConflict : schedulingErrorText(code, errors));

  const toForm = (r: ResourceRecord | null): Form => ({ name: r?.name ?? "", type: r?.type ?? "room", description: r?.description ?? "", serviceIds: r?.serviceIds ?? [] });
  function open(r: ResourceRecord | null) {
    const f = toForm(r);
    setEditing(r ? r.id : null);
    setForm(f);
    setBaseline(f);
    setError(null);
    setConfirmOff(false);
  }
  function backToList() { setEditing(undefined); setForm(null); setBaseline(null); setError(null); setConfirmOff(false); }

  const current = typeof editing === "string" ? resources.find((r) => r.id === editing) : undefined;
  const changed = Boolean(form && baseline && (form.name !== baseline.name || form.type !== baseline.type || form.description !== baseline.description || !sameIds(form.serviceIds, baseline.serviceIds)));
  const dirty = Boolean(form && (editing === null ? form.name.trim() !== "" || form.serviceIds.length > 0 : changed));
  const canSave = Boolean(form && form.name.trim() && dirty && !pending);
  // A resource that still has links cannot change type (the server enforces it too).
  const typeLocked = Boolean(baseline && baseline.serviceIds.length > 0 && editing !== null);
  useUnsavedGuard(dirty);
  const status: SaveState = pending ? "saving" : error ? "error" : dirty ? "dirty" : notice ? "saved" : "idle";
  const patch = (p: Partial<Form>) => { setForm((f) => (f ? { ...f, ...p } : f)); setError(null); setNotice(null); };

  function save() {
    if (!form || !canSave) return;
    setError(null);
    startTransition(async () => {
      const input = { name: form.name, type: form.type as never, description: form.description, serviceIds: form.serviceIds };
      const r = editing === null ? await createResourceAction(workspaceSlug, input) : await updateResourceAction(workspaceSlug, editing as string, input);
      if (!r.ok) return setError(errorText(r.code));
      const saved = r.data;
      setResources((list) => (editing === null ? [...list, saved] : list.map((x) => (x.id === saved.id ? saved : x))));
      open(saved);
      setNotice(editing === null ? messages.created : messages.saved);
    });
  }

  function setActive(resource: ResourceRecord, active: boolean) {
    setError(null);
    startTransition(async () => {
      const r = await setResourceActiveAction(workspaceSlug, resource.id, active);
      if (!r.ok) return setError(errorText(r.code));
      setResources((list) => list.map((x) => (x.id === resource.id ? r.data : x)));
      setNotice(active ? messages.reactivated : messages.deactivated);
      if (editing === resource.id) backToList();
    });
  }

  const row = (r: ResourceRecord) => (
    <li key={r.id} className={styles.row}>
      <div className={styles.rowBody}>
        <p className={styles.rowLabel}>
          {r.name}
          {!r.active && <span className={styles.badge}>{messages.inactiveBadge}</span>}
        </p>
        <p className={styles.rowMeta}>{typeName(r.type)}{r.description ? ` · ${r.description}` : ""}</p>
        {!readOnly && (
          <div className={styles.chips}>
            {r.serviceIds.length === 0 ? <span className={styles.chip}>{messages.noLinks}</span> : r.serviceIds.map((id) => <span key={id} className={styles.chip}>{serviceName(id)}</span>)}
          </div>
        )}
      </div>
      <button type="button" className={styles.textButton} onClick={() => open(r)} disabled={pending}>{messages.edit}</button>
      {!readOnly && !r.active && <button type="button" className={styles.textButton} onClick={() => setActive(r, true)} disabled={pending}>{messages.reactivate}</button>}
    </li>
  );

  const active = resources.filter((r) => r.active);
  const inactive = resources.filter((r) => !r.active);
  const typeOptions = form && !(resourceTypes as readonly string[]).includes(form.type) ? [form.type, ...resourceTypes] : [...resourceTypes];

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
          {active.length === 0 && <p className={styles.empty}>{messages.empty}</p>}
          {active.length > 0 && <ul className={styles.list}>{active.map(row)}</ul>}
          {!readOnly && <Button variant="secondary" onClick={() => open(null)}>{messages.addButton}</Button>}
          {inactive.length > 0 && (
            <section style={{ marginTop: "var(--space-6)" }}>
              <h2 className={styles.sectionTitle}>{messages.inactiveSection}</h2>
              <ul className={styles.list}>{inactive.map(row)}</ul>
            </section>
          )}
        </>
      )}

      {form && (
        <>
          <fieldset disabled={readOnly || pending} className={styles.fieldset} style={{ gap: "var(--space-5, 20px)" }}>
            <Input label={messages.nameLabel} value={form.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })} error={!form.name.trim() && dirty ? messages.nameRequired : undefined} />
            <label className={styles.field}>
              <span>{messages.typeLabel}</span>
              <select suppressHydrationWarning className={styles.select} value={form.type} disabled={typeLocked} onChange={(e) => patch({ type: e.target.value })}>
                {typeOptions.map((t) => <option key={t} value={t}>{typeName(t)}</option>)}
              </select>
              {typeLocked && <span className={styles.hint}>{messages.typeLocked}</span>}
            </label>
            <label className={styles.field}>
              <span>{messages.descriptionLabel}</span>
              <textarea suppressHydrationWarning className={styles.textarea} rows={3} maxLength={300} value={form.description} onChange={(e) => patch({ description: e.target.value })} />
              <span className={styles.hint}>{messages.descriptionHint}</span>
            </label>
            <div className={styles.fieldset}>
              <span className={styles.legend}>{messages.servicesLabel}</span>
              {services.length === 0 ? <p className={styles.hint}>{messages.noServices}</p> : services.map((s) => (
                <label key={s.id} className={styles.check}>
                  <input
                    suppressHydrationWarning
                    type="checkbox"
                    checked={form.serviceIds.includes(s.id)}
                    onChange={() => patch({ serviceIds: form.serviceIds.includes(s.id) ? form.serviceIds.filter((x) => x !== s.id) : [...form.serviceIds, s.id] })}
                  />
                  <span>{s.name}</span>
                </label>
              ))}
              <p className={styles.hint}>{messages.servicesHint}</p>
            </div>
          </fieldset>

          {!readOnly && (
            <div className={styles.saveBar}>
              <SaveStatus state={status} labels={{ ...statusLabels, saved: notice ?? statusLabels.saved }} error={error} onSavedExpire={expire} />
              <Button fullWidth onClick={save} disabled={!canSave}>{pending ? statusLabels.saving : messages.save}</Button>
            </div>
          )}

          {!readOnly && current && (
            <section className={styles.section} style={{ marginTop: "var(--space-6)" }}>
              {current.active ? (
                confirmOff ? (
                  <div className={styles.confirm} role="alertdialog" aria-label={messages.deactivateTitle.replace("{name}", current.name)}>
                    <p className={styles.confirmTitle}>{messages.deactivateTitle.replace("{name}", current.name)}</p>
                    <p>{messages.deactivateText}</p>
                    <div className={styles.actions}>
                      <Button variant="secondary" onClick={() => setConfirmOff(false)} disabled={pending}>{hours.keep}</Button>
                      <Button onClick={() => setActive(current, false)} disabled={pending}>{messages.deactivateYes}</Button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className={`${styles.textButton} ${styles.dangerButton}`} onClick={() => setConfirmOff(true)} disabled={pending}>{messages.deactivate}</button>
                )
              ) : (
                <button type="button" className={styles.textButton} onClick={() => setActive(current, true)} disabled={pending}>{messages.reactivate}</button>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
