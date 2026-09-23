"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Icon } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import styles from "./page.module.css";

interface TextMessage {
  kind: "text";
  id: string;
  role: "user" | "assistant";
  text: string;
}

interface ActionMessage {
  kind: "action";
  id: string;
  role: "assistant";
}

type ThreadMessage = TextMessage | ActionMessage;

export function AssistantView({
  workspaceSlug,
  messages,
}: {
  workspaceSlug: string;
  messages: Messages["assistant"];
}) {
  const router = useRouter();
  const [thread, setThread] = useState<ThreadMessage[]>([
    { kind: "text", id: "intro", role: "assistant", text: messages.subtitle },
  ]);
  const [draft, setDraft] = useState("");
  // Which action-card messages the demo "Confirm" was already pressed on
  // — keeps the button from re-firing and shows the card as handled.
  const [confirmedActionIds, setConfirmedActionIds] = useState<Set<string>>(new Set());

  const suggestions = [
    messages.suggestion1,
    messages.suggestion2,
    messages.suggestion3,
    messages.suggestion4,
  ];

  function send(text: string) {
    if (!text.trim()) return;
    const userMessage: TextMessage = {
      kind: "text",
      id: `${Date.now()}-user`,
      role: "user",
      text,
    };

    const isMoveRequest = /move|перенес|перенос|verschieb/i.test(text);

    const replyMessage: ThreadMessage = isMoveRequest
      ? { kind: "action", id: `${Date.now()}-action`, role: "assistant" }
      : {
          kind: "text",
          id: `${Date.now()}-assistant`,
          role: "assistant",
          text: messages.demoReplyIntro,
        };

    setThread((current) => [...current, userMessage, replyMessage]);
    setDraft("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(draft);
  }

  function handleConfirmAction(messageId: string) {
    if (confirmedActionIds.has(messageId)) return;
    setConfirmedActionIds((current) => new Set(current).add(messageId));
    setThread((current) => [
      ...current,
      {
        kind: "text",
        id: `${Date.now()}-confirmed`,
        role: "assistant",
        text: messages.actionConfirmedReply,
      },
    ]);
  }

  function handleEditAction() {
    router.push(`/${workspaceSlug}/calendar`);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>
          <span className={styles.sparkDot} />
          {messages.title}
        </span>
        <h1 className={styles.greeting}>{messages.greeting}</h1>
        <p className={styles.subtitle}>{messages.subtitle}</p>
      </header>

      <div className={styles.attentionRow}>
        <span className={styles.attentionChip}>2 unconfirmed</span>
        <span className={styles.attentionChip}>€420 overdue</span>
        <span className={styles.attentionChip}>1 empty slot</span>
      </div>

      <div className={styles.thread}>
        {thread.map((message) => {
          if (message.kind === "action") {
            return (
              <div key={message.id} className={styles.bubbleRow}>
                <div className={styles.actionCard}>
                  <div className={styles.actionCardHeader}>{messages.actionMoveAppointment}</div>
                  <div className={styles.actionCardBody}>
                    <div className={styles.actionCardTitle}>Anna Müller</div>
                    <div className={styles.actionCardMeta}>Fri 25 Sep · 14:00 → 16:30</div>
                  </div>
                  <div className={styles.actionCardActions}>
                    <Button
                      size="sm"
                      onClick={() => handleConfirmAction(message.id)}
                      disabled={confirmedActionIds.has(message.id)}
                    >
                      {confirmedActionIds.has(message.id) ? messages.actionConfirmed : messages.actionConfirm}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={handleEditAction}>
                      {messages.actionEdit}
                    </Button>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              key={message.id}
              className={`${styles.bubbleRow} ${message.role === "user" ? styles.bubbleRowUser : ""}`}
            >
              <div
                className={`${styles.bubble} ${message.role === "user" ? styles.bubbleUser : styles.bubbleAssistant}`}
              >
                {message.text}
              </div>
            </div>
          );
        })}

        {thread.length === 1 && (
          <div className={styles.suggestions}>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className={styles.suggestionButton}
                onClick={() => send(suggestion)}
              >
                {suggestion}
                <Icon name="chevronRight" size={16} />
              </button>
            ))}
          </div>
        )}
      </div>

      <form className={styles.composer} onSubmit={handleSubmit}>
        <input
          type="text"
          className={styles.composerInput}
          placeholder={messages.composerPlaceholder}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className={styles.sendButton} disabled={!draft.trim()} aria-label={messages.send}>
          <Icon name="send" size={18} />
        </button>
      </form>
    </div>
  );
}
