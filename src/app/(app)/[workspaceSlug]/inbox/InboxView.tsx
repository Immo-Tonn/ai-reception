"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/ui";
import { useConversations } from "@/features/inbox/useConversations";
import type { Conversation, ConversationChannel, ConversationStatus } from "@/features/inbox/types";
import type { Locale, Messages } from "@/lib/i18n";
import { formatDate, formatTime } from "@/lib/i18n/format";
import styles from "./page.module.css";

const channelIcon: Record<ConversationChannel, "inbox" | "phone" | "mail"> = {
  webChat: "inbox",
  whatsapp: "phone",
  email: "mail",
  sms: "phone",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

type FilterKey = "all" | "unread" | ConversationStatus;

export function InboxView({
  workspaceSlug,
  locale,
  messages,
}: {
  workspaceSlug: string;
  locale: Locale;
  messages: Messages["inbox"];
}) {
  const { items: conversations } = useConversations(workspaceSlug);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations
      .filter((c) => {
        if (filter === "unread") return c.unread;
        if (filter === "all") return true;
        return c.status === filter;
      })
      .filter(
        (c) =>
          !q ||
          c.clientName.toLowerCase().includes(q) ||
          c.lastMessagePreview.toLowerCase().includes(q),
      )
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }, [conversations, query, filter]);

  const statusLabel: Record<ConversationStatus, string> = {
    open: messages.statusOpen,
    pending: messages.statusPending,
    resolved: messages.statusResolved,
  };

  const statusClass: Record<ConversationStatus, string> = {
    open: styles.statusOpen,
    pending: styles.statusPending,
    resolved: styles.statusResolved,
  };

  const filterOptions: { key: FilterKey; label: string }[] = [
    { key: "all", label: messages.filterAll },
    { key: "unread", label: messages.filterUnread },
    { key: "open", label: messages.filterOpen },
    { key: "pending", label: messages.filterPending },
    { key: "resolved", label: messages.filterResolved },
  ];

  function formatTimestamp(conversation: Conversation) {
    const date = new Date(conversation.lastMessageAt);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    return isToday
      ? formatTime(date, locale)
      : formatDate(date, locale, { month: "short", day: "numeric" });
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.title}</h1>
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

      <div className={styles.filterRow}>
        {filterOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`${styles.filterChip} ${filter === option.key ? styles.filterChipActive : ""}`}
            onClick={() => setFilter(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>{messages.emptyTitle}</span>
          <span className={styles.emptyDescription}>{messages.emptyDescription}</span>
        </div>
      ) : (
        <div className={styles.list}>
          {filtered.map((conversation) => (
            <a
              key={conversation.id}
              href={`/${workspaceSlug}/inbox/${conversation.id}`}
              className={styles.row}
            >
              <span className={styles.avatar}>{initials(conversation.clientName)}</span>
              <span className={styles.body}>
                <span className={styles.nameRow}>
                  <span className={styles.name}>{conversation.clientName}</span>
                  <span className={styles.channelIcon}>
                    <Icon name={channelIcon[conversation.channel]} size={14} />
                  </span>
                </span>
                <span className={styles.preview}>{conversation.lastMessagePreview}</span>
              </span>
              <span className={styles.meta}>
                <span className={styles.time}>{formatTimestamp(conversation)}</span>
                {conversation.unread ? (
                  <span className={styles.unreadDot} aria-label={messages.unreadBadge} />
                ) : (
                  <span className={`${styles.statusBadge} ${statusClass[conversation.status]}`}>
                    {statusLabel[conversation.status]}
                  </span>
                )}
              </span>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
