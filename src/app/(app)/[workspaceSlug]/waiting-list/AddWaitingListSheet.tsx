"use client";

import { useState } from "react";
import { Button, Input, Sheet } from "@/components/ui";
import { getServiceLabel } from "@/features/services/label";
import { getStaffLabel } from "@/features/staff/label";
import { useClients } from "@/features/clients/useClients";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import {
  useWorkspaceConfig,
  useWorkspaceToday,
} from "@/features/workspace/WorkspaceCatalog";
import type { WaitingListEntry } from "@/features/waitingList/types";
import type { Locale, Messages } from "@/lib/i18n";
import { formatDate } from "@/lib/i18n/format";
import styles from "./AddWaitingListSheet.module.css";

const GUEST = "";
// Monday-first display order; values are JS weekdays (0 = Sunday), same as matching.ts.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function WaitingListForm({
  onClose,
  onSave,
  messages,
  workspaceSlug,
  locale,
  youLabel,
  initial,
}: {
  onClose: () => void;
  /** Resolves when saved; rejects (RemoteRepositoryError) when the backend refuses. */
  onSave: (entry: WaitingListEntry) => Promise<void>;
  messages: Messages["waitingList"];
  workspaceSlug: string;
  locale: Locale;
  youLabel: string;
  /** Edit mode: the entry being edited. */
  initial?: WaitingListEntry | null;
}) {
  const real = !isDemoWorkspaceSlug(workspaceSlug);
  const workspace = useWorkspaceConfig(workspaceSlug);
  const today = useWorkspaceToday(workspaceSlug);
  const { items: clients } = useClients(workspaceSlug);
  const services = workspace.services.filter((s) => s.active !== false);
  const staff = workspace.staff;

  const [clientId, setClientId] = useState(initial?.clientId ?? GUEST);
  const [guestName, setGuestName] = useState(
    initial?.clientId ? "" : (initial?.client ?? ""),
  );
  const [guestPhone, setGuestPhone] = useState(initial?.guestPhone ?? "");
  const [guestEmail, setGuestEmail] = useState(initial?.guestEmail ?? "");
  const [serviceId, setServiceId] = useState(
    initial
      ? ((real
          ? initial.serviceId
          : services.find((s) => s.name === initial.service)?.id) ?? "")
      : (services[0]?.id ?? ""),
  );
  const [staffId, setStaffId] = useState(
    initial
      ? ((real
          ? initial.preferredStaffId
          : staff.find((s) => s.name === initial.preferredStaff)?.id) ?? "")
      : "",
  );
  const [earliestDate, setEarliestDate] = useState(
    initial?.earliestDate ?? today,
  );
  const [latestDate, setLatestDate] = useState(initial?.latestDate ?? today);
  const [days, setDays] = useState<number[]>(initial?.preferredDays ?? []);
  const [timeStart, setTimeStart] = useState(initial?.preferredTimeStart ?? "");
  const [timeEnd, setTimeEnd] = useState(initial?.preferredTimeEnd ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleDay(day: number) {
    setDays((current) =>
      current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day].sort(),
    );
  }

  async function handleSave() {
    const linked = clients.find((c) => c.id === clientId);
    const name = linked ? linked.name : guestName.trim();
    if (!name) return setError(messages.nameRequired);
    const service = services.find((s) => s.id === serviceId);
    if (!service) return setError(messages.serviceRequired);
    if (latestDate < earliestDate) return setError(messages.dateError);
    if (timeStart && timeEnd && timeStart > timeEnd)
      return setError(messages.timeError);
    const person = staff.find((s) => s.id === staffId);

    setSaving(true);
    setError(null);
    try {
      await onSave({
        id: initial?.id ?? crypto.randomUUID(),
        client: name,
        clientId: linked && real ? linked.id : null,
        guestPhone: linked ? (linked.phone ?? "") : guestPhone.trim(),
        guestEmail: linked ? (linked.email ?? "") : guestEmail.trim(),
        service: service.name,
        serviceId: real ? service.id : null,
        preferredStaff: person?.name ?? null,
        preferredStaffId: real ? (person?.id ?? null) : null,
        earliestDate,
        latestDate,
        preferredDays: days,
        preferredTimeStart: timeStart || null,
        preferredTimeEnd: timeEnd || null,
        notes: notes.trim(),
        status: initial?.status ?? "waiting",
      });
      onClose();
    } catch (e) {
      const code =
        e instanceof Error && "code" in e
          ? (e as { code: unknown }).code
          : null;
      setError(
        code === "forbidden" ? messages.forbiddenError : messages.saveError,
      );
    } finally {
      setSaving(false);
    }
  }

  const weekdayName = (day: number) =>
    formatDate(new Date(2024, 0, 7 + day), locale, { weekday: "short" });

  return (
    <div className={styles.form}>
      {real && clients.length > 0 ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="wl-client">
            {messages.clientLabel}
          </label>
          <select
            suppressHydrationWarning
            id="wl-client"
            className={styles.select}
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          >
            <option value={GUEST}>{messages.guestOption}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {clientId === GUEST ? (
        <>
          <Input
            label={messages.nameLabel}
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            maxLength={200}
          />
          <div className={styles.row2}>
            <Input
              label={messages.phoneLabel}
              type="tel"
              value={guestPhone}
              onChange={(event) => setGuestPhone(event.target.value)}
              maxLength={40}
            />
            <Input
              label={messages.emailLabel}
              type="email"
              value={guestEmail}
              onChange={(event) => setGuestEmail(event.target.value)}
              maxLength={200}
            />
          </div>
        </>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="wl-service">
          {messages.serviceLabel}
        </label>
        <select
          suppressHydrationWarning
          id="wl-service"
          className={styles.select}
          value={serviceId}
          onChange={(event) => setServiceId(event.target.value)}
        >
          {services.length === 0 ? (
            <option value="">{messages.noServices}</option>
          ) : null}
          {services.map((item) => (
            <option key={item.id} value={item.id}>
              {getServiceLabel(item, locale)}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="wl-staff">
          {messages.preferredStaffLabel}
        </label>
        <select
          suppressHydrationWarning
          id="wl-staff"
          className={styles.select}
          value={staffId}
          onChange={(event) => setStaffId(event.target.value)}
        >
          <option value="">{messages.anyStaff}</option>
          {staff.map((item) => (
            <option key={item.id} value={item.id}>
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

      <div className={styles.field}>
        <span className={styles.label}>{messages.weekdaysLabel}</span>
        <div
          className={styles.days}
          role="group"
          aria-label={messages.weekdaysLabel}
        >
          {WEEKDAY_ORDER.map((day) => (
            <button
              key={day}
              type="button"
              className={`${styles.day} ${days.includes(day) ? styles.dayOn : ""}`}
              aria-pressed={days.includes(day)}
              onClick={() => toggleDay(day)}
            >
              {weekdayName(day)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.row2}>
        <Input
          label={messages.timeFromLabel}
          type="time"
          value={timeStart}
          onChange={(event) => setTimeStart(event.target.value)}
        />
        <Input
          label={messages.timeToLabel}
          type="time"
          value={timeEnd}
          onChange={(event) => setTimeEnd(event.target.value)}
        />
      </div>

      <Input
        label={messages.notesLabel}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        maxLength={1000}
      />

      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}

      <Button fullWidth onClick={handleSave} disabled={saving}>
        {saving
          ? messages.loading
          : initial
            ? messages.saveChanges
            : messages.save}
      </Button>
    </div>
  );
}

export function AddWaitingListSheet({
  open,
  onClose,
  onSave,
  messages,
  workspaceSlug,
  locale,
  youLabel,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  /** Resolves when saved; rejects (RemoteRepositoryError) when the backend refuses. */
  onSave: (entry: WaitingListEntry) => Promise<void>;
  messages: Messages["waitingList"];
  workspaceSlug: string;
  locale: Locale;
  youLabel: string;
  /** Edit mode: the entry being edited. */
  initial?: WaitingListEntry | null;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? messages.editEntry : messages.addEntry}
    >
      {/* The Sheet renders nothing while closed, so the form's state starts fresh each time it opens. */}
      <WaitingListForm
        onClose={onClose}
        onSave={onSave}
        messages={messages}
        workspaceSlug={workspaceSlug}
        locale={locale}
        youLabel={youLabel}
        initial={initial}
      />
    </Sheet>
  );
}
