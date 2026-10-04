"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { Button, Icon, Input, SaveStatus } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import type { ActionErrorCode } from "@/server/actions/result";
import { describeSaveError } from "@/lib/repository/describeSaveError";
import { RemoteRepositoryError } from "@/lib/repository/createRemoteRepository";
import type { ServiceDefinition } from "@/features/services/types";
import {
  createServiceAction,
  removeServiceAction,
  updateServiceAction,
} from "@/server/actions/services.actions";
import styles from "./page.module.css";

interface FormState {
  name: string;
  durationMinutes: string;
  price: string;
  currency: string;
  bufferBeforeMinutes: string;
  bufferAfterMinutes: string;
  active: boolean;
  allowedStaffIds: string[];
  description: string;
}

const emptyForm: FormState = {
  name: "",
  durationMinutes: "30",
  price: "0",
  currency: "EUR",
  bufferBeforeMinutes: "0",
  bufferAfterMinutes: "0",
  active: true,
  allowedStaffIds: [],
  description: "",
};

function toFormState(service: ServiceDefinition): FormState {
  return {
    name: service.name,
    durationMinutes: String(service.durationMinutes),
    price: String(service.price),
    currency: service.currency,
    bufferBeforeMinutes: String(service.bufferBeforeMinutes),
    bufferAfterMinutes: String(service.bufferAfterMinutes),
    active: service.active !== false,
    allowedStaffIds: service.allowedStaffIds,
    description: service.description ?? "",
  };
}

export function ServicesView({
  workspaceSlug,
  initialServices,
  staff,
  messages,
  extra,
  errors,
  backLabel,
  statusLabels,
}: {
  workspaceSlug: string;
  initialServices: ServiceDefinition[];
  staff: { id: string; name: string }[];
  messages: Messages["settingsServices"];
  extra: Messages["servicesSettings"];
  errors: Messages["repositoryErrors"];
  backLabel: string;
  statusLabels: { unsaved: string; saving: string; saved: string };
}) {
  const [services, setServices] = useState(initialServices);
  // Stable action code -> localized text (never raw error text, never an unhandled rejection).
  const errorText = (code: ActionErrorCode) =>
    code === "invalid_input" ? messages.errorInvalid : describeSaveError(new RemoteRepositoryError(code), errors);
  const [notice, setNotice] = useState<string | null>(null);
  const expireNotice = useCallback(() => setNotice(null), []);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openCreateForm() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setNotice(null);
    setFormOpen(true);
  }

  function openEditForm(service: ServiceDefinition) {
    setEditingId(service.id);
    setForm(toFormState(service));
    setError(null);
    setNotice(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setError(null);
  }

  function handleSubmit() {
    setError(null);
    const input = {
      name: form.name,
      durationMinutes: Number(form.durationMinutes) || 0,
      price: Number(form.price) || 0,
      currency: form.currency,
      bufferBeforeMinutes: Number(form.bufferBeforeMinutes) || 0,
      bufferAfterMinutes: Number(form.bufferAfterMinutes) || 0,
      allowedStaffIds: form.allowedStaffIds,
      description: form.description,
    };

    startTransition(async () => {
      if (editingId) {
        const result = await updateServiceAction(workspaceSlug, editingId, { ...input, active: form.active });
        if (!result.ok) return setError(errorText(result.code));
        const updated = result.data;
        if (updated) setServices((current) => current.map((s) => (s.id === editingId ? updated : s)));
      } else {
        const result = await createServiceAction(workspaceSlug, input);
        if (!result.ok) return setError(errorText(result.code));
        setServices((current) => [...current, result.data]);
      }
      setNotice(editingId ? extra.saved : extra.created);
      setFormOpen(false);
    });
  }

  function handleArchive(service: ServiceDefinition) {
    if (!window.confirm(extra.archiveConfirm)) return;
    setError(null);
    startTransition(async () => {
      const result = await removeServiceAction(workspaceSlug, service.id);
      if (!result.ok) return setError(errorText(result.code));
      setServices((current) => current.map((s) => (s.id === service.id ? { ...s, active: false } : s)));
      setNotice(extra.archived);
    });
  }

  function handleRestore(service: ServiceDefinition) {
    setError(null);
    startTransition(async () => {
      const result = await updateServiceAction(workspaceSlug, service.id, { active: true });
      if (!result.ok) return setError(errorText(result.code));
      const updated = result.data;
      if (updated) setServices((current) => current.map((s) => (s.id === service.id ? updated : s)));
      setNotice(extra.restored);
    });
  }

  function toggleStaff(id: string) {
    setForm((f) => ({
      ...f,
      allowedStaffIds: f.allowedStaffIds.includes(id) ? f.allowedStaffIds.filter((x) => x !== id) : [...f.allowedStaffIds, id],
    }));
  }

  const activeServices = services.filter((s) => s.active !== false);
  const archivedServices = services.filter((s) => s.active === false);

  const renderRow = (service: ServiceDefinition, archived: boolean) => (
    <li key={service.id} className={styles.row}>
      <div className={styles.rowBody}>
        <p className={styles.rowLabel}>
          {service.name}
          {archived && <span className={styles.badge}>{extra.archivedBadge}</span>}
        </p>
        <p className={styles.rowMeta}>
          {service.durationMinutes} {messages.minutesSuffix} · {service.price} {service.currency}
        </p>
      </div>
      <div className={styles.rowActions}>
        <button type="button" className={styles.iconButton} onClick={() => openEditForm(service)} disabled={isPending}>
          {messages.edit}
        </button>
        {archived ? (
          <button type="button" className={styles.iconButton} onClick={() => handleRestore(service)} disabled={isPending}>
            {extra.restore}
          </button>
        ) : (
          <button type="button" className={styles.iconButtonDanger} onClick={() => handleArchive(service)} disabled={isPending}>
            {extra.archive}
          </button>
        )}
      </div>
    </li>
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href={`/${workspaceSlug}/settings`} className={styles.backButton} aria-label={backLabel}>
          <Icon name="chevronRight" size={18} style={{ transform: "rotate(180deg)" }} />
        </Link>
        <div>
          <h1 className={styles.title}>{messages.title}</h1>
          <p className={styles.subtitle}>{messages.subtitle}</p>
        </div>
      </header>

      {error && !formOpen && <p className={styles.error} role="alert">{error}</p>}
      {!formOpen && (
        <SaveStatus
          state={isPending ? "saving" : notice ? "saved" : "idle"}
          labels={{ unsaved: "", saving: statusLabels.saving, saved: notice ?? statusLabels.saved }}
          onSavedExpire={expireNotice}
        />
      )}

      {activeServices.length === 0 && !formOpen && <p className={styles.empty}>{messages.emptyState}</p>}

      {activeServices.length > 0 && <ul className={styles.list}>{activeServices.map((s) => renderRow(s, false))}</ul>}

      {formOpen ? (
        <div className={styles.form}>
          <h2 className={styles.formTitle}>{editingId ? extra.editTitle : extra.newTitle}</h2>
          <SaveStatus state={isPending ? "saving" : error ? "error" : "idle"} labels={statusLabels} error={error} />
          <Input
            label={messages.nameLabel}
            placeholder={messages.namePlaceholder}
            value={form.name}
            onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
          />
          <label className={styles.field}>
            <span className={styles.legend}>{extra.descriptionLabel}</span>
            <textarea
              suppressHydrationWarning
              className={styles.textarea}
              rows={3}
              maxLength={1000}
              placeholder={extra.descriptionPlaceholder}
              value={form.description}
              onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
            />
            <span className={styles.hint}>{extra.descriptionHint}</span>
          </label>
          <div className={styles.formRow}>
            <Input
              label={messages.durationLabel}
              inputMode="numeric"
              value={form.durationMinutes}
              onChange={(event) => setForm((f) => ({ ...f, durationMinutes: event.target.value }))}
            />
            <Input
              label={messages.priceLabel}
              inputMode="decimal"
              value={form.price}
              onChange={(event) => setForm((f) => ({ ...f, price: event.target.value }))}
            />
            <Input
              label={messages.currencyLabel}
              value={form.currency}
              onChange={(event) => setForm((f) => ({ ...f, currency: event.target.value }))}
            />
          </div>
          <div className={styles.formRow}>
            <Input
              label={messages.bufferBeforeLabel}
              inputMode="numeric"
              value={form.bufferBeforeMinutes}
              onChange={(event) => setForm((f) => ({ ...f, bufferBeforeMinutes: event.target.value }))}
            />
            <Input
              label={messages.bufferAfterLabel}
              inputMode="numeric"
              value={form.bufferAfterMinutes}
              onChange={(event) => setForm((f) => ({ ...f, bufferAfterMinutes: event.target.value }))}
            />
          </div>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>{extra.staffLabel}</legend>
            {staff.length === 0 ? (
              <p className={styles.hint}>{extra.noStaff}</p>
            ) : (
              <>
                {staff.map((member) => (
                  <label key={member.id} className={styles.check}>
                    <input
                      suppressHydrationWarning
                      type="checkbox"
                      checked={form.allowedStaffIds.includes(member.id)}
                      onChange={() => toggleStaff(member.id)}
                    />
                    <span>{member.name}</span>
                  </label>
                ))}
                <p className={styles.hint}>{form.allowedStaffIds.length === 0 ? extra.staffAll : extra.staffHint}</p>
              </>
            )}
          </fieldset>
          {editingId && (
            <label className={styles.check}>
              <input
                      suppressHydrationWarning
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm((f) => ({ ...f, active: event.target.checked }))}
              />
              <span>
                {extra.activeLabel}
                <span className={styles.hint}>{extra.activeHint}</span>
              </span>
            </label>
          )}
          <div className={styles.formActions}>
            <Button variant="secondary" type="button" onClick={closeForm} disabled={isPending}>
              {messages.cancel}
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={isPending}>
              {isPending ? statusLabels.saving : messages.save}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" type="button" onClick={openCreateForm}>
          {messages.addButton}
        </Button>
      )}

      {archivedServices.length > 0 && (
        <section className={styles.archived}>
          <h2 className={styles.formTitle}>{extra.archivedSection}</h2>
          <ul className={styles.list}>{archivedServices.map((s) => renderRow(s, true))}</ul>
        </section>
      )}
      <p className={styles.hint}>{extra.removeHistoryNote}</p>
    </main>
  );
}
