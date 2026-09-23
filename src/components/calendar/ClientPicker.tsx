"use client";

import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui";
import type { ClientRecord } from "@/features/clients/types";
import type { Messages } from "@/lib/i18n";
import styles from "./ClientPicker.module.css";

interface ClientPickerProps {
  clients: ClientRecord[];
  value: string;
  onSelect: (client: ClientRecord) => void;
  onCreateClient: (client: ClientRecord) => void;
  messages: Messages["appointment"];
  /** Workspace-specific override for the "Client" label — e.g. "Vehicle"
   * for a Werkstatt, "Property" for Cleaning. */
  clientLabelOverride?: string;
}

function makeClientId() {
  return `client-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

export function ClientPicker({
  clients,
  value,
  onSelect,
  onCreateClient,
  messages,
  clientLabelOverride,
}: ClientPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => clients.find((c) => c.name === value) ?? null,
    [clients, value],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients.slice(0, 8);
    return clients
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [clients, query]);

  function openPanel() {
    setOpen(true);
    setQuery("");
    setCreating(false);
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function closePanel() {
    setOpen(false);
    setCreating(false);
    setQuery("");
    setNewEmail("");
    setNewPhone("");
  }

  function handleSelect(client: ClientRecord) {
    onSelect(client);
    closePanel();
  }

  function handleStartCreate() {
    setCreating(true);
  }

  function handleCreateSave() {
    const name = query.trim();
    if (!name) return;
    const client: ClientRecord = {
      id: makeClientId(),
      name,
      email: newEmail,
      phone: newPhone,
      tags: ["new"],
      lastVisit: null,
      upcoming: [],
      history: [],
      notes: "",
    };
    onCreateClient(client);
    onSelect(client);
    closePanel();
  }

  return (
    <div className={styles.field}>
      <label className={styles.label}>{clientLabelOverride ?? messages.clientLabel}</label>

      {!open && (
        <button type="button" className={styles.trigger} onClick={openPanel}>
          {selected || value ? (
            <span>
              {value}
              {selected && (selected.phone || selected.email) && (
                <span className={styles.triggerMeta}>
                  {" "}
                  · {selected.phone || selected.email}
                </span>
              )}
            </span>
          ) : (
            <span className={styles.triggerPlaceholder}>{messages.clientPlaceholder}</span>
          )}
          <Icon name="chevronRight" size={16} />
        </button>
      )}

      {open && (
        <div className={styles.panel}>
          <input
            ref={searchRef}
            type="text"
            className={styles.searchInput}
            placeholder={messages.clientPlaceholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCreating(false);
            }}
          />

          {!creating && (
            <div className={styles.results}>
              {results.length === 0 ? (
                <div className={styles.emptyState}>{messages.clientNoResults}</div>
              ) : (
                results.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    className={styles.resultRow}
                    onClick={() => handleSelect(client)}
                  >
                    <span className={styles.resultName}>{client.name}</span>
                    {(client.phone || client.email) && (
                      <span className={styles.resultMeta}>
                        {client.phone || client.email}
                      </span>
                    )}
                  </button>
                ))
              )}

              {query.trim() && (
                <button type="button" className={styles.createButton} onClick={handleStartCreate}>
                  <Icon name="plus" size={16} />
                  {messages.clientCreateNew.replace("{query}", query.trim())}
                </button>
              )}
            </div>
          )}

          {creating && (
            <div className={styles.createForm}>
              <span className={styles.resultName}>{query.trim()}</span>
              <input
                type="email"
                className={styles.searchInput}
                placeholder={messages.clientCreateEmailLabel}
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
              />
              <input
                type="tel"
                className={styles.searchInput}
                placeholder={messages.clientCreatePhoneLabel}
                value={newPhone}
                onChange={(event) => setNewPhone(event.target.value)}
              />
              <button type="button" className={styles.createButton} onClick={handleCreateSave}>
                <Icon name="check" size={16} />
                {messages.clientCreateSave}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
