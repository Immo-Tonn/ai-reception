"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Icon } from "@/components/ui";
import { useConversations } from "@/features/inbox/useConversations";
import { useClients } from "@/features/clients/useClients";
import type { ConversationStatus, InboxMessage } from "@/features/inbox/types";
import type { ClientRecord } from "@/features/clients/types";
import type { Locale, Messages } from "@/lib/i18n";
import { formatDateTime } from "@/lib/i18n/format";
import styles from "./page.module.css";

function makeClientId() {
  return `client-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

export function ConversationView({
  workspaceSlug,
  conversationId,
  locale,
  messages,
}: {
  workspaceSlug: string;
  conversationId: string;
  locale: Locale;
  messages: Messages["inbox"];
}) {
  const router = useRouter();
  const { items: conversations, update, loaded } = useConversations(workspaceSlug);
  const { create: createClient } = useClients(workspaceSlug);

  const conversation = conversations.find((c) => c.id === conversationId) ?? null;

  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [body, setBody] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);
  const markedRef = useRef(false);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [conversation?.messages.length]);

  useEffect(() => {
    if (conversation && conversation.unread && !markedRef.current) {
      markedRef.current = true;
      update(conversation.id, { unread: false });
    }
  }, [conversation, update]);

  const templates = useMemo(
    () => [
      { id: "greeting", label: messages.templateGreeting },
      { id: "availability", label: messages.templateAvailability },
      { id: "confirmation", label: messages.templateConfirmation },
    ],
    [messages],
  );

  if (!loaded) return null;

  if (!conversation) {
    return (
      <main className={styles.page}>
        <div className={styles.header}>
          <a href={`/${workspaceSlug}/inbox`} className={styles.backLink}>
            <Icon name="chevronRight" size={18} />
          </a>
        </div>
        <div className={styles.notFound}>{messages.notFound}</div>
      </main>
    );
  }

  const statusOptions: { value: ConversationStatus; label: string }[] = [
    { value: "open", label: messages.statusOpen },
    { value: "pending", label: messages.statusPending },
    { value: "resolved", label: messages.statusResolved },
  ];

  function handleSend() {
    if (!conversation || !body.trim()) return;
    const newMessage: InboxMessage = {
      id: `${Date.now()}`,
      author: "staff",
      authorName: "You",
      body: body.trim(),
      createdAt: new Date().toISOString(),
      internal: mode === "note",
    };
    update(conversation.id, {
      messages: [...conversation.messages, newMessage],
      lastMessageAt: newMessage.createdAt,
      lastMessagePreview: mode === "note" ? conversation.lastMessagePreview : newMessage.body,
    });
    setBody("");
  }

  function handleTemplate(templateId: string) {
    const template = templates.find((t) => t.id === templateId);
    if (!template || !conversation) return;
    setBody(template.label.replace("{name}", conversation.clientName.split(" ")[0]));
  }

  function handleAiDraft() {
    setMode("reply");
    setBody(messages.aiDraftBody);
  }

  function handleStatusChange(status: ConversationStatus) {
    if (!conversation) return;
    update(conversation.id, { status });
  }

  async function handleCreateClient() {
    if (!conversation) return;
    const client: ClientRecord = {
      id: makeClientId(),
      name: conversation.clientName,
      email: conversation.channel === "email" ? "" : "",
      phone: "",
      tags: ["new"],
      lastVisit: null,
      upcoming: [],
      history: [],
      notes: "",
    };
    await createClient(client);
    await update(conversation.id, { clientId: client.id });
  }

  function handleNewAppointment() {
    if (!conversation) return;
    router.push(
      `/${workspaceSlug}/calendar?create=appointment&client=${encodeURIComponent(conversation.clientName)}`,
    );
  }

  function handleNewLead() {
    if (!conversation) return;
    router.push(
      `/${workspaceSlug}/work?create=lead&client=${encodeURIComponent(conversation.clientName)}`,
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <a href={`/${workspaceSlug}/inbox`} className={styles.backLink} aria-label={messages.back}>
          <Icon name="chevronRight" size={18} />
        </a>
        <div className={styles.headerBody}>
          <span className={styles.headerName}>{conversation.clientName}</span>
          <span className={styles.headerMeta}>
            {conversation.clientId ? messages.clientProfile : messages.noClientLinked}
          </span>
        </div>
      </div>

      <div className={styles.statusRow}>
        {statusOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`${styles.statusChip} ${conversation.status === option.value ? styles.statusChipActive : ""}`}
            onClick={() => handleStatusChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className={styles.convertRow}>
        {conversation.clientId ? (
          <a
            className={styles.convertButton}
            href={`/${workspaceSlug}/clients/${conversation.clientId}`}
          >
            {messages.clientProfile}
          </a>
        ) : (
          <button type="button" className={styles.convertButton} onClick={handleCreateClient}>
            {messages.convertToClient}
          </button>
        )}
        <button type="button" className={styles.convertButton} onClick={handleNewAppointment}>
          {messages.newAppointment}
        </button>
        <button type="button" className={styles.convertButton} onClick={handleNewLead}>
          {messages.newLead}
        </button>
      </div>

      <div className={styles.thread} ref={threadRef}>
        {conversation.messages.map((message) => (
          <div
            key={message.id}
            className={`${styles.bubbleRow} ${message.author === "staff" ? styles.bubbleRowStaff : ""}`}
          >
            <div
              className={`${styles.bubble} ${message.author === "staff" ? styles.bubbleStaff : ""} ${message.internal ? styles.bubbleInternal : ""}`}
            >
              {message.internal && (
                <span className={styles.internalTag}>{messages.internalNoteLabel}</span>
              )}
              <div>{message.body}</div>
              <span className={styles.bubbleMeta}>
                {message.authorName} · {formatDateTime(new Date(message.createdAt), locale)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.composer}>
        <div className={styles.composerTabs}>
          <button
            type="button"
            className={`${styles.composerTab} ${mode === "reply" ? styles.composerTabActive : ""}`}
            onClick={() => setMode("reply")}
          >
            {messages.replyTab}
          </button>
          <button
            type="button"
            className={`${styles.composerTab} ${mode === "note" ? styles.composerTabActive : ""}`}
            onClick={() => setMode("note")}
          >
            {messages.noteTab}
          </button>
        </div>

        <textarea
          className={styles.composerTextarea}
          placeholder={mode === "reply" ? messages.composerPlaceholder : messages.composerInternalPlaceholder}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />

        <div className={styles.composerActions}>
          <div className={styles.composerLeftActions}>
            <select
              className={styles.templateSelect}
              value=""
              onChange={(event) => handleTemplate(event.target.value)}
            >
              <option value="" disabled>
                {messages.templatesLabel}
              </option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label.slice(0, 28)}…
                </option>
              ))}
            </select>
            {mode === "reply" && (
              <button type="button" className={styles.aiButton} onClick={handleAiDraft}>
                {messages.aiDraftButton}
              </button>
            )}
          </div>
          <Button onClick={handleSend}>{messages.send}</Button>
        </div>
        {mode === "reply" && <span className={styles.aiNotice}>{messages.aiDraftNotice}</span>}
      </div>
    </main>
  );
}
