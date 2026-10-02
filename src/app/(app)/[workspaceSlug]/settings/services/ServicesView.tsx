"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button, Icon, Input } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import type { ActionErrorCode } from "@/server/actions/result";
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
}

const emptyForm: FormState = {
  name: "",
  durationMinutes: "30",
  price: "0",
  currency: "EUR",
  bufferBeforeMinutes: "0",
  bufferAfterMinutes: "0",
};

function toFormState(service: ServiceDefinition): FormState {
  return {
    name: service.name,
    durationMinutes: String(service.durationMinutes),
    price: String(service.price),
    currency: service.currency,
    bufferBeforeMinutes: String(service.bufferBeforeMinutes),
    bufferAfterMinutes: String(service.bufferAfterMinutes),
  };
}

export function ServicesView({
  workspaceSlug,
  initialServices,
  messages,
  backLabel,
}: {
  workspaceSlug: string;
  initialServices: ServiceDefinition[];
  messages: Messages["settingsServices"];
  backLabel: string;
}) {
  const [services, setServices] = useState(initialServices);
  const errorText = (code: ActionErrorCode) =>
    code === "forbidden" || code === "unauthenticated"
      ? messages.errorForbidden
      : code === "invalid_input"
        ? messages.errorInvalid
        : messages.errorGeneric;
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openCreateForm() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setFormOpen(true);
  }

  function openEditForm(service: ServiceDefinition) {
    setEditingId(service.id);
    setForm(toFormState(service));
    setError(null);
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
    };

    startTransition(async () => {
      if (editingId) {
        const result = await updateServiceAction(workspaceSlug, editingId, input);
        if (!result.ok) return setError(errorText(result.code));
        const updated = result.data;
        if (updated) setServices((current) => current.map((s) => (s.id === editingId ? updated : s)));
      } else {
        const result = await createServiceAction(workspaceSlug, input);
        if (!result.ok) return setError(errorText(result.code));
        setServices((current) => [...current, result.data]);
      }
      setFormOpen(false);
    });
  }

  function handleRemove(id: string) {
    if (!window.confirm(messages.removeConfirm)) return;
    startTransition(async () => {
      const result = await removeServiceAction(workspaceSlug, id);
      if (!result.ok) return setError(errorText(result.code));
      setServices((current) => current.filter((s) => s.id !== id));
    });
  }

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

      {error && !formOpen && <p className={styles.error}>{error}</p>}

      {services.length === 0 && !formOpen && <p className={styles.empty}>{messages.emptyState}</p>}

      {services.length > 0 && (
        <ul className={styles.list}>
          {services.map((service) => (
            <li key={service.id} className={styles.row}>
              <div className={styles.rowBody}>
                <p className={styles.rowLabel}>{service.name}</p>
                <p className={styles.rowMeta}>
                  {service.durationMinutes} {messages.minutesSuffix} · {service.price} {service.currency}
                </p>
              </div>
              <div className={styles.rowActions}>
                <button type="button" className={styles.iconButton} onClick={() => openEditForm(service)}>
                  {messages.edit}
                </button>
                <button
                  type="button"
                  className={styles.iconButtonDanger}
                  onClick={() => handleRemove(service.id)}
                  disabled={isPending}
                >
                  {messages.remove}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {formOpen ? (
        <div className={styles.form}>
          {error && <p className={styles.error}>{error}</p>}
          <Input
            label={messages.nameLabel}
            placeholder={messages.namePlaceholder}
            value={form.name}
            onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
          />
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
          <div className={styles.formActions}>
            <Button variant="secondary" type="button" onClick={closeForm} disabled={isPending}>
              {messages.cancel}
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={isPending}>
              {messages.save}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" type="button" onClick={openCreateForm}>
          {messages.addButton}
        </Button>
      )}
    </main>
  );
}
