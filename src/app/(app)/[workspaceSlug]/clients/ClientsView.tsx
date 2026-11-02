"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Icon } from "@/components/ui";
import { useClients } from "@/features/clients/useClients";
import { useWorkspaceConfig } from "@/features/workspace/WorkspaceCatalog";
import type { Locale, Messages } from "@/lib/i18n";
import { formatDate } from "@/lib/i18n/format";
import { listArchivedClientsAction } from "@/server/actions/clientArchive.actions";
import type { ClientRecord } from "@/features/clients/types";
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
  canArchive = false,
}: {
  workspaceSlug: string;
  locale: Locale;
  messages: Messages["clients"];
  /** Owner / admin (decided on the server): shows the Active / Archive switch. */
  canArchive?: boolean;
}) {
  const searchParams = useSearchParams();
  const { items: clients, create: createClient } = useClients(workspaceSlug);
  const workspace = useWorkspaceConfig(workspaceSlug);
  const pageTitle = workspace.clientLabelPlural ?? messages.title;
  const [query, setQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(searchParams.get("create") === "client");

  // Active clients come from the regular list (the server returns active ones only);
  // the archive is loaded separately, on demand.
  const [view, setView] = useState<"active" | "archive">("active");
  const [archived, setArchived] = useState<ClientRecord[] | null>(null);
  useEffect(() => {
    if (view !== "archive" || archived !== null) return;
    let cancelled = false;
    void listArchivedClientsAction(workspaceSlug).then((r) => {
      if (!cancelled) setArchived(r.ok ? r.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [view, archived, workspaceSlug]);
  const filtered = useMemo(() => {
    const source = view === "archive" ? (archived ?? []) : clients;
    const q = query.trim().toLowerCase();
    if (!q) return source;
    return source.filter((client) => client.name.toLowerCase().includes(q));
  }, [view, archived, clients, query]);

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
        <input suppressHydrationWarning
          type="search"
          className={styles.searchInput}
          placeholder={messages.searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {canArchive && (
        <div className={styles.viewSwitcher} role="group" aria-label={messages.viewSwitchLabel}>
          {(["active", "archive"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={`${styles.viewTab} ${view === key ? styles.viewTabActive : ""}`}
              aria-pressed={view === key}
              onClick={() => setView(key)}
            >
              {key === "active" ? messages.viewActive : messages.viewArchive}
            </button>
          ))}
        </div>
      )}

      {view === "archive" && filtered.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyDescription}>{archived === null ? "…" : messages.archiveEmpty}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>{messages.emptyTitle}</span>
          <span className={styles.emptyDescription}>{messages.emptyDescription}</span>
          <Button onClick={() => setSheetOpen(true)}>{messages.addClient}</Button>
        </div>
      ) : (
        <div className={styles.list}>
          {filtered.map((client) => (
            <Link
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
                  {client.archivedAt
                    ? messages.archivedOn.replace("{date}", formatDate(new Date(client.archivedAt), locale, { dateStyle: "medium" }))
                    : client.lastVisit
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
            </Link>
          ))}
        </div>
      )}

      {view === "active" && (
        <button
          type="button"
          className={styles.fab}
          onClick={() => setSheetOpen(true)}
          aria-label={messages.addClient}
        >
          <Icon name="plus" size={24} />
        </button>
      )}

      <AddClientSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSave={(client) => createClient(client)}
        messages={messages}
      />
    </main>
  );
}
