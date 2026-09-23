"use client";

import { useState } from "react";
import { Button, Input, Sheet } from "@/components/ui";
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
  onSave: (client: ClientRecord) => void;
  messages: Messages["clients"];
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  function handleSave() {
    if (!name.trim()) return;
    onSave({
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
        <Button fullWidth onClick={handleSave}>
          {messages.save}
        </Button>
      </div>
    </Sheet>
  );
}
