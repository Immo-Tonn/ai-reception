"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Icon } from "@/components/ui";
import { useClients } from "@/features/clients/useClients";
import { getWorkspaceConfig } from "@/features/workspace/registry";
import type { Locale, Messages } from "@/lib/i18n";
import { formatDate } from "@/lib/i18n/format";
import { AddClientSheet } from "./AddClientSheet";
import styles from "./page.module.css";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ClientsView({
  workspaceSlug,
  locale,
  messages,
}: {
  workspaceSlug: string;
  locale: Locale;
  messages: Messages["clients"];
}) {
  const searchParams = useSearchParams();
  const { items: clients, create: createClient } = useClients(workspaceSlug);
  const workspace = useMemo(() => getWorkspaceConfig(workspaceSlug), [workspaceSlug]);
  const pageTitle = workspace.clientLabelPlural ?? messages.title;
  const [query, setQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(searchParams.get("create") === "client");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((client) => client.name.toLowerCase().includes(q));
  }, [clients, query]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{pageTitle}</h1>
        <Button className={styles.newButton} onClick={() => setSheetOpen(true)}>
          {messages.addClient}
        </Button>
      </header>

      <div className={styles.searchField}>
        <span className={styles.searchIcon}>
          <Icon name="search" size={18} />
        </span>
        <input
          type="search"
          className={styles.searchInput}
          placeholder={messages.searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>{messages.emptyTitle}</span>
          <span className={styles.emptyDescription}>{messages.emptyDescription}</span>
          <Button onClick={() => setSheetOpen(true)}>{messages.addClient}</Button>
        </div>
      ) : (
        <div className={styles.list}>
          {filtered.map((client) => (
            <a
              key={client.id}
              href={`/${workspaceSlug}/clients/${client.id}`}
              className={styles.row}
            >
              <span className={styles.avatar}>{initials(client.name)}</span>
              <span className={styles.body}>
                <span className={styles.nameRow}>
                  <span className={styles.name}>{client.name}</span>
                  {client.tags.includes("vip") && (
                    <span className={`${styles.tag} ${styles.tagVip}`}>{messages.tagVip}</span>
                  )}
                  {client.tags.includes("new") && (
                    <span className={`${styles.tag} ${styles.tagNew}`}>{messages.tagNew}</span>
                  )}
                </span>
                <span className={styles.meta}>
                  {client.lastVisit
                    ? messages.lastVisit.replace(
                        "{date}",
                        formatDate(new Date(client.lastVisit), locale, { dateStyle: "medium" }),
                      )
                    : messages.noVisitsYet}
                </span>
              </span>
              <span className={styles.chevron}>
                <Icon name="chevronRight" size={18} />
              </span>
            </a>
          ))}
        </div>
      )}

      <button
        type="button"
        className={styles.fab}
        onClick={() => setSheetOpen(true)}
        aria-label={messages.addClient}
      >
        <Icon name="plus" size={24} />
      </button>

      <AddClientSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSave={(client) => createClient(client)}
        messages={messages}
      />
    </main>
  );
}
