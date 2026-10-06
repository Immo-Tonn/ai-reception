"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button, Icon, Input } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import type { StaffMember } from "@/features/staff/types";
import {
  createStaffAction,
  removeStaffAction,
  updateStaffAction,
  type StaffActionResult,
} from "@/server/actions/staff.actions";
import styles from "../services/page.module.css";

export function StaffView({
  workspaceSlug,
  initialStaff,
  messages,
  backLabel,
}: {
  workspaceSlug: string;
  initialStaff: StaffMember[];
  messages: Messages["settingsStaff"];
  backLabel: string;
}) {
  const [staff, setStaff] = useState(initialStaff);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function errorText(result: Extract<StaffActionResult<unknown>, { ok: false }>): string {
    if (result.error === "last_one") return messages.lastOneError;
    if (result.error === "duplicate") return messages.duplicateError;
    return messages.errorGeneric;
  }

  function openCreateForm() {
    setEditingId(null);
    setName("");
    setError(null);
    setFormOpen(true);
  }

  function openEditForm(member: StaffMember) {
    setEditingId(member.id);
    setName(member.name);
    setError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setError(null);
  }

  function handleSubmit() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError(messages.errorGeneric);
      return;
    }
    startTransition(async () => {
      if (editingId) {
        const result = await updateStaffAction(workspaceSlug, editingId, { name: trimmed });
        if (!result.ok) return setError(errorText(result));
        const updated = result.data;
        if (updated) {
          setStaff((current) => current.map((s) => (s.id === editingId ? updated : s)));
        }
      } else {
        const result = await createStaffAction(workspaceSlug, { name: trimmed });
        if (!result.ok) return setError(errorText(result));
        setStaff((current) => [...current, result.data]);
      }
      setFormOpen(false);
    });
  }

  function handleRemove(id: string) {
    if (!window.confirm(messages.removeConfirm)) return;
    setError(null);
    startTransition(async () => {
      const result = await removeStaffAction(workspaceSlug, id);
      if (!result.ok) return setError(errorText(result));
      setStaff((current) => current.filter((s) => s.id !== id));
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

      {staff.length === 0 && !formOpen && <p className={styles.empty}>{messages.emptyState}</p>}

      {staff.length > 0 && (
        <ul className={styles.list}>
          {staff.map((member) => (
            <li key={member.id} className={styles.row}>
              <div className={styles.rowBody}>
                <p className={styles.rowLabel}>{member.name}</p>
              </div>
              <div className={styles.rowActions}>
                <button type="button" className={styles.iconButton} onClick={() => openEditForm(member)}>
                  {messages.edit}
                </button>
                <button
                  type="button"
                  className={styles.iconButtonDanger}
                  onClick={() => handleRemove(member.id)}
                  disabled={isPending || staff.length <= 1}
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
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
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
