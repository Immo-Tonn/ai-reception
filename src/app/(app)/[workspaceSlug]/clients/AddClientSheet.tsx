"use client";

import { useState } from "react";
import { Button, Input, Sheet } from "@/components/ui";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { describeSaveError } from "@/lib/repository/describeSaveError";
import type { Messages } from "@/lib/i18n";
import type { ClientRecord } from "@/features/clients/types";
import styles from "./AddClientSheet.module.css";

export function AddClientSheet({
  open,
  onClose,
  onSave,
  messages,
}: {
  open: boolean;
  onClose: () => void;
  /** May reject (e.g. duplicate e-mail on a real workspace): the sheet then stays open and says why. */
  onSave: (client: ClientRecord) => Promise<unknown> | void;
  messages: Messages["clients"];
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { messages: all } = useI18n();

  async function handleSave() {
    if (!name.trim() || saving) return;
    setError(null);
    setSaving(true);
    try {
      await onSave({
      id: `${Date.now()}`,
      name,
      email,
      phone,
      tags: ["new"],
      lastVisit: null,
      upcoming: [],
      history: [],
      notes: "",
      });
      setName("");
      setEmail("");
      setPhone("");
      onClose();
    } catch (err) {
      setError(describeSaveError(err, all.repositoryErrors, { duplicateClient: true }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={messages.addClient}>
      <div className={styles.form}>
        <Input
          label={messages.nameLabel}
          placeholder={messages.namePlaceholder}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          label={messages.emailLabel}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          label={messages.phoneLabel}
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
        <Button fullWidth onClick={handleSave} disabled={saving}>
          {saving ? all.common.saveStatus.saving : messages.save}
        </Button>
      </div>
    </Sheet>
  );
}
