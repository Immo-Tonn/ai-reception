"use client";

import { useState } from "react";
import { Button, Input, Sheet } from "@/components/ui";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { describeSaveError } from "@/lib/repository/describeSaveError";
import type { Messages } from "@/lib/i18n";
import type { ClientRecord } from "@/features/clients/types";
import styles from "../AddClientSheet.module.css";

/**
 * Edits the business-side CRM record only (name, contact, notes, VIP tag).
 * A rejected save (duplicate e-mail, invalid input, no permission) keeps the
 * sheet open and explains why. Unsaved edits are discarded when it closes.
 */
export function EditClientSheet({
  client,
  open,
  onClose,
  onSave,
  messages,
}: {
  client: ClientRecord;
  open: boolean;
  onClose: () => void;
  onSave: (patch: Pick<ClientRecord, "name" | "email" | "phone" | "notes" | "tags">) => Promise<unknown>;
  messages: Messages["clients"];
}) {
  const [name, setName] = useState(client.name);
  const [email, setEmail] = useState(client.email);
  const [phone, setPhone] = useState(client.phone);
  const [notes, setNotes] = useState(client.notes);
  const [vip, setVip] = useState(client.tags.includes("vip"));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { messages: all } = useI18n();

  async function handleSave() {
    if (!name.trim() || saving) return;
    setError(null);
    setSaving(true);
    try {
      // Only the VIP flag is user-editable here; the system "new" tag is kept as is.
      const rest = client.tags.filter((tag) => tag !== "vip");
      await onSave({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        notes,
        tags: vip ? [...rest, "vip"] : rest,
      });
      onClose();
    } catch (err) {
      setError(describeSaveError(err, all.repositoryErrors, { duplicateClient: true }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={messages.editTitle}>
      <div className={styles.form}>
        <Input label={messages.nameLabel} value={name} onChange={(event) => setName(event.target.value)} />
        <Input label={messages.emailLabel} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <Input label={messages.phoneLabel} type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
        <label className={styles.field}>
          <span>{messages.notesLabel}</span>
          <textarea
            suppressHydrationWarning
            className={styles.textarea}
            rows={4}
            maxLength={2000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        <label className={styles.checkRow}>
          <input suppressHydrationWarning type="checkbox" checked={vip} onChange={(event) => setVip(event.target.checked)} />
          <span>{messages.vipLabel}</span>
        </label>
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
        <Button fullWidth onClick={handleSave} disabled={saving}>
          {saving ? all.common.saveStatus.saving : messages.saveChanges}
        </Button>
      </div>
    </Sheet>
  );
}
