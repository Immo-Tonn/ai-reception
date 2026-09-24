"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
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
  // -1 = nothing highlighted; 0..results.length-1 = a result row;
  // results.length = the "create new" row, when it's showing.
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => clients.find((c) => c.name === value) ?? null,
    [clients, value],
  );

  // Empty query → a handful of recent clients (list order — the newest
  // demo/created entries sort first in every preset) instead of an
  // empty panel, so focusing the field alone is already useful.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients.slice(0, 8);
    return clients
      .filter((c) => {
        if (
          c.name.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q)
        ) {
          return true;
        }
        // Vehicle/license-plate style fields (Werkstatt) or any other
        // workspace's custom fields — searchable the same way, without
        // a separate per-industry search UI.
        return (c.customFields ?? []).some((field) => field.value.toLowerCase().includes(q));
      })
      .slice(0, 8);
  }, [clients, query]);

  const showCreateRow = query.trim().length > 0;
  const optionCount = results.length + (showCreateRow ? 1 : 0);

  function openPanel() {
    setOpen(true);
    setQuery("");
    setCreating(false);
    setActiveIndex(-1);
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function closePanel() {
    setOpen(false);
    setCreating(false);
    setQuery("");
    setNewEmail("");
    setNewPhone("");
    setActiveIndex(-1);
  }

  function handleSelect(client: ClientRecord) {
    onSelect(client);
    closePanel();
  }

  function handleStartCreate() {
    setCreating(true);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (creating) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (optionCount > 0) setActiveIndex((current) => (current + 1) % optionCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (optionCount > 0) setActiveIndex((current) => (current - 1 + optionCount) % optionCount);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && activeIndex < results.length) {
        handleSelect(results[activeIndex]);
      } else if (activeIndex === results.length && showCreateRow) {
        handleStartCreate();
      } else if (results.length === 1) {
        handleSelect(results[0]);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
    }
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
              setActiveIndex(-1);
            }}
            onKeyDown={handleSearchKeyDown}
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
          />

          {!creating && (
            <div className={styles.results} role="listbox">
              {results.length === 0 ? (
                <div className={styles.emptyState}>{messages.clientNoResults}</div>
              ) : (
                results.map((client, index) => (
                  <button
                    key={client.id}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`${styles.resultRow} ${index === activeIndex ? styles.resultRowActive : ""}`}
                    onMouseEnter={() => setActiveIndex(index)}
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

              {showCreateRow && (
                <button
                  type="button"
                  className={`${styles.createButton} ${activeIndex === results.length ? styles.resultRowActive : ""}`}
                  onMouseEnter={() => setActiveIndex(results.length)}
                  onClick={handleStartCreate}
                >
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
