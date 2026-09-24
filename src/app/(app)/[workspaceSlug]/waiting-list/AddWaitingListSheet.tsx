"use client";

import { useState } from "react";
import { Button, Input, Sheet } from "@/components/ui";
import { getWorkspaceConfig } from "@/features/workspace/registry";
import { getServiceLabel } from "@/features/services/label";
import { getStaffLabel } from "@/features/staff/label";
import type { WaitingListEntry } from "@/features/waitingList/types";
import type { Locale, Messages } from "@/lib/i18n";
import styles from "./AddWaitingListSheet.module.css";

export function AddWaitingListSheet({
  open,
  onClose,
  onSave,
  messages,
  workspaceSlug,
  locale,
  youLabel,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (entry: WaitingListEntry) => void;
  messages: Messages["waitingList"];
  workspaceSlug: string;
  locale: Locale;
  youLabel: string;
}) {
  const workspace = getWorkspaceConfig(workspaceSlug);
  const demoServices = workspace.services;
  const demoStaff = workspace.staff;
  const [client, setClient] = useState("");
  const [service, setService] = useState(demoServices[0]?.name ?? "");
  const [preferredStaff, setPreferredStaff] = useState("");
  const [earliestDate, setEarliestDate] = useState("2026-09-22");
  const [latestDate, setLatestDate] = useState("2026-09-30");

  function handleSave() {
    if (!client.trim()) return;
    onSave({
      id: `${Date.now()}`,
      client,
      service,
      preferredStaff: preferredStaff || null,
      earliestDate,
      latestDate,
      preferredDays: [],
      preferredTimeStart: null,
      preferredTimeEnd: null,
    });
    setClient("");
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={messages.addEntry}>
      <div className={styles.form}>
        <Input
          label={messages.clientLabel}
          value={client}
          onChange={(event) => setClient(event.target.value)}
        />

        <div className={styles.field}>
          <label className={styles.label}>{messages.serviceLabel}</label>
          <select
            className={styles.select}
            value={service}
            onChange={(event) => setService(event.target.value)}
          >
            {demoServices.map((item) => (
              <option key={item.id} value={item.name}>
                {getServiceLabel(item, locale)}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>{messages.preferredStaffLabel}</label>
          <select
            className={styles.select}
            value={preferredStaff}
            onChange={(event) => setPreferredStaff(event.target.value)}
          >
            <option value="">{messages.anyStaff}</option>
            {demoStaff.map((item) => (
              <option key={item.id} value={item.name}>
                {getStaffLabel(item.name, youLabel)}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.row2}>
          <Input
            label={messages.earliestDateLabel}
            type="date"
            value={earliestDate}
            onChange={(event) => setEarliestDate(event.target.value)}
          />
          <Input
            label={messages.latestDateLabel}
            type="date"
            value={latestDate}
            onChange={(event) => setLatestDate(event.target.value)}
          />
        </div>

        <Button fullWidth onClick={handleSave}>
          {messages.save}
        </Button>
      </div>
    </Sheet>
  );
}
