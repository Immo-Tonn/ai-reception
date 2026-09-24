"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Icon, Input, Sheet } from "@/components/ui";
import { ClientPicker } from "./ClientPicker";
import type { ClientRecord } from "@/features/clients/types";
import { localIsoDate } from "@/lib/date/localIsoDate";
import type {
  Appointment,
  AppointmentStatus,
  FinancialBucket,
  RecurrenceFrequency,
  Visibility,
} from "@/features/appointments/types";
import { statusOrder } from "@/features/appointments/statusMeta";
import { findConflicts, findNextAvailableSlot } from "@/features/appointments/conflicts";
import { expandRecurrenceDates } from "@/features/appointments/recurrence";
import { checkAvailability } from "@/features/workingHours/logic";
import type { ServiceDefinition } from "@/features/services/types";
import { getServiceLabel } from "@/features/services/label";
import type { StaffMember } from "@/features/staff/types";
import { getStaffLabel } from "@/features/staff/label";
import type { ResourceDefinition } from "@/features/resources/types";
import { getResourceLabel } from "@/features/resources/label";
import type { WorkingHoursProfile } from "@/features/workingHours/types";
import type { Locale, Messages } from "@/lib/i18n";
import styles from "./AppointmentSheet.module.css";

export type AppointmentSaveResult =
  | { mode: "create"; appointments: Appointment[] }
  | { mode: "updateOne"; id: string; patch: Partial<Appointment> }
  | { mode: "updateSeries"; seriesId: string; fromDate: string; patch: Partial<Appointment> };

interface AppointmentSheetProps {
  open: boolean;
  onClose: () => void;
  /** May be async (e.g. awaits the repository write) — the sheet stays
   * open and shows an inline error if this rejects, instead of closing
   * on a save that never actually persisted. */
  onSave: (result: AppointmentSaveResult) => void | Promise<void>;
  onDelete?: () => void;
  locale: Locale;
  messages: Messages["appointment"];
  statusMessages: Messages["appointmentStatus"];
  conflictMessages: Messages["conflict"];
  recurrenceMessages: Messages["recurrence"];
  initialValue?: Appointment | null;
  defaultDate?: string;
  allAppointments: Appointment[];
  services: ServiceDefinition[];
  staffList: StaffMember[];
  resources: ResourceDefinition[];
  workingHours: WorkingHoursProfile[];
  clients: ClientRecord[];
  onCreateClient: (client: ClientRecord) => void;
  prefillClient?: string;
  clientLabelOverride?: string;
  staffLabelOverride?: string;
  resourceLabelOverride?: string;
  noResourceLabelOverride?: string;
  youLabel: string;
}

function todayIso() {
  return localIsoDate(new Date());
}

export function AppointmentSheet({
  open,
  onClose,
  onSave,
  onDelete,
  locale,
  messages,
  statusMessages,
  conflictMessages,
  recurrenceMessages,
  initialValue,
  defaultDate,
  allAppointments,
  services,
  staffList,
  resources,
  workingHours,
  clients,
  onCreateClient,
  prefillClient,
  clientLabelOverride,
  staffLabelOverride,
  resourceLabelOverride,
  noResourceLabelOverride,
  youLabel,
}: AppointmentSheetProps) {
  const isEditing = Boolean(initialValue);
  const isSeries = Boolean(initialValue?.seriesId);

  const [client, setClient] = useState(initialValue?.client ?? prefillClient ?? "");
  const [serviceName, setServiceName] = useState(initialValue?.service ?? services[0]?.name ?? "");
  const [staff, setStaff] = useState(initialValue?.staff ?? staffList[0]?.name ?? "");
  const [date, setDate] = useState(initialValue?.date ?? defaultDate ?? todayIso());
  const [time, setTime] = useState(initialValue?.time ?? "09:00");
  const [duration, setDuration] = useState(
    initialValue?.durationMinutes ?? services[0]?.durationMinutes ?? 30,
  );
  const [price, setPrice] = useState(initialValue?.price ?? services[0]?.price ?? 0);
  const [notes, setNotes] = useState(initialValue?.notes ?? "");
  // Internal appointment (Owner/Staff, this form) defaults to CONFIRMED —
  // only a client-created Public Booking defaults to PENDING (see
  // publicBooking.service.ts). Editing an existing appointment always
  // keeps its own status regardless of this default.
  const [status, setStatus] = useState<AppointmentStatus>(initialValue?.status ?? "confirmed");
  const [resourceId, setResourceId] = useState<string | null>(initialValue?.resourceId ?? null);
  const [visibility, setVisibility] = useState<Visibility>(initialValue?.visibility ?? "normal");
  const [financialBucket, setFinancialBucket] = useState<FinancialBucket>(
    initialValue?.financialBucket ?? "main",
  );
  const [recurrenceFreq, setRecurrenceFreq] = useState<RecurrenceFrequency | "none">("none");
  const [recurrenceCount, setRecurrenceCount] = useState(4);
  const [recurrenceIntervalDays, setRecurrenceIntervalDays] = useState(10);
  const [applyToSeries, setApplyToSeries] = useState(false);
  const [validationError, setValidationError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedService = services.find((s) => s.name === serviceName);

  // Keep duration/price in sync with the chosen service, but only when
  // creating — editing shouldn't silently overwrite a custom price.
  useEffect(() => {
    if (isEditing || !selectedService) return;
    setDuration(selectedService.durationMinutes);
    setPrice(selectedService.price);
    if (!selectedService.requiredResourceType) setResourceId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceName]);

  const eligibleStaff = useMemo(() => {
    if (!selectedService || selectedService.allowedStaffIds.length === 0) return staffList;
    return staffList.filter((s) => selectedService.allowedStaffIds.includes(s.id));
  }, [selectedService, staffList]);

  const eligibleResources = useMemo(
    () => resources.filter((r) => r.type === selectedService?.requiredResourceType),
    [resources, selectedService],
  );

  const availability = checkAvailability(staff, date, time, duration, workingHours);
  const conflict = findConflicts(
    { id: initialValue?.id ?? "new", staff, resourceId, date, time, durationMinutes: duration, service: serviceName },
    allAppointments,
    services,
  );

  const suggestion =
    (!availability.available || conflict.hasConflict) && staff
      ? findNextAvailableSlot({
          staff,
          resourceId,
          service: serviceName,
          durationMinutes: duration,
          fromDate: date,
          fromTime: time,
          existing: allAppointments,
          services,
          workingHours,
        })
      : null;

  const recurrencePreviewDates =
    !isEditing && recurrenceFreq !== "none"
      ? expandRecurrenceDates(date, {
          frequency: recurrenceFreq,
          intervalDays: recurrenceFreq === "custom" ? recurrenceIntervalDays : undefined,
          count: recurrenceCount,
        })
      : [];

  function applySuggestion() {
    if (!suggestion) return;
    setDate(suggestion.date);
    setTime(suggestion.time);
  }

  function buildBaseFields() {
    return {
      client,
      service: serviceName,
      staff,
      resourceId,
      price,
      currency: "EUR",
      notes,
      visibility,
      financialBucket,
      status,
      paid: initialValue?.paid ?? false,
    };
  }

  async function handleSave() {
    setSaveError(false);
    if (!client.trim() || !staff) {
      setValidationError(true);
      return;
    }
    setValidationError(false);

    let result: AppointmentSaveResult;

    if (!isEditing && recurrenceFreq !== "none") {
      const seriesId = `series-${Date.now()}`;
      const dates = recurrencePreviewDates;
      const created: Appointment[] = [];
      for (const occurrenceDate of dates) {
        const occurrenceConflict = findConflicts(
          {
            id: "new",
            staff,
            resourceId,
            date: occurrenceDate,
            time,
            durationMinutes: duration,
            service: serviceName,
          },
          [...allAppointments, ...created],
          services,
        );
        if (occurrenceConflict.hasConflict) continue;
        created.push({
          id: `${Date.now()}-${occurrenceDate}`,
          date: occurrenceDate,
          time,
          durationMinutes: duration,
          seriesId,
          recurrence: {
            frequency: recurrenceFreq,
            intervalDays: recurrenceFreq === "custom" ? recurrenceIntervalDays : undefined,
            count: recurrenceCount,
          },
          ...buildBaseFields(),
        });
      }
      result = { mode: "create", appointments: created };
    } else if (isEditing && initialValue) {
      const patch: Partial<Appointment> = {
        ...buildBaseFields(),
        durationMinutes: duration,
        ...(applyToSeries ? {} : { date, time }),
      };

      result =
        isSeries && applyToSeries && initialValue.seriesId
          ? {
              mode: "updateSeries",
              seriesId: initialValue.seriesId,
              fromDate: initialValue.date,
              patch,
            }
          : { mode: "updateOne", id: initialValue.id, patch: { ...patch, date, time } };
    } else {
      // Single, non-recurring create.
      result = {
        mode: "create",
        appointments: [
          {
            id: `${Date.now()}`,
            date,
            time,
            durationMinutes: duration,
            seriesId: null,
            recurrence: null,
            ...buildBaseFields(),
          },
        ],
      };
    }

    setSaving(true);
    try {
      await onSave(result);
      onClose();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to save appointment", error);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  const visibilityOptions: { value: Visibility; title: string; hint: string }[] = [
    { value: "normal", title: messages.visibilityNormal, hint: messages.visibilityNormalHint },
    { value: "private", title: messages.visibilityPrivate, hint: messages.visibilityPrivateHint },
    {
      value: "ownerOnly",
      title: messages.visibilityOwnerOnly,
      hint: messages.visibilityOwnerOnlyHint,
    },
    { value: "custom", title: messages.visibilityCustom, hint: messages.visibilityCustomHint },
  ];

  const bucketOptions: { value: FinancialBucket; title: string }[] = [
    { value: "main", title: messages.bucketMain },
    { value: "private", title: messages.bucketPrivate },
    { value: "custom", title: messages.bucketCustom },
  ];

  const conflictMessage = conflict.staffConflict
    ? {
        title: conflictMessages.staffTitle,
        description: conflictMessages.staffDescription
          .replace("{staff}", staff)
          .replace("{client}", conflict.staffConflict.client),
      }
    : conflict.resourceConflict
      ? {
          title: conflictMessages.resourceTitle,
          description: conflictMessages.resourceDescription.replace(
            "{resource}",
            resources.find((r) => r.id === resourceId)?.name ?? "",
          ),
        }
      : !availability.available
        ? {
            title:
              availability.reason === "dayOff"
                ? conflictMessages.dayOffTitle
                : availability.reason === "onBreak"
                  ? conflictMessages.onBreakTitle
                  : availability.reason === "timeOff"
                    ? conflictMessages.timeOffTitle
                    : availability.reason === "blocked"
                      ? conflictMessages.blockedTitle
                      : conflictMessages.outsideHoursTitle,
            description: (availability.reason === "dayOff"
              ? conflictMessages.dayOffDescription
              : availability.reason === "onBreak"
                ? conflictMessages.onBreakDescription
                : availability.reason === "timeOff"
                  ? conflictMessages.timeOffDescription
                  : availability.reason === "blocked"
                    ? conflictMessages.blockedDescription
                    : conflictMessages.outsideHoursDescription
            ).replace("{staff}", staff),
          }
        : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isEditing ? messages.editTitle : messages.createTitle}
    >
      <div className={styles.form}>
        <ClientPicker
          clients={clients}
          value={client}
          onSelect={(selectedClient) => setClient(selectedClient.name)}
          onCreateClient={onCreateClient}
          messages={messages}
          clientLabelOverride={clientLabelOverride}
        />

        <div className={styles.field}>
          <label className={styles.label}>{messages.serviceLabel}</label>
          <select
            className={styles.select}
            value={serviceName}
            onChange={(event) => setServiceName(event.target.value)}
          >
            {services.map((item) => (
              <option key={item.id} value={item.name}>
                {getServiceLabel(item, locale)}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>{staffLabelOverride ?? messages.staffLabel}</label>
          <select
            className={styles.select}
            value={staff}
            onChange={(event) => setStaff(event.target.value)}
          >
            {eligibleStaff.map((item) => (
              <option key={item.id} value={item.name}>
                {getStaffLabel(item.name, youLabel)}
              </option>
            ))}
          </select>
        </div>

        {selectedService?.requiredResourceType && (
          <div className={styles.field}>
            <label className={styles.label}>{resourceLabelOverride ?? messages.resourceLabel}</label>
            <select
              className={styles.select}
              value={resourceId ?? ""}
              onChange={(event) => setResourceId(event.target.value || null)}
            >
              <option value="">{noResourceLabelOverride ?? messages.resourceNone}</option>
              {eligibleResources.map((item) => (
                <option key={item.id} value={item.id}>
                  {getResourceLabel(item, locale)}
                </option>
              ))}
            </select>
          </div>
        )}

        {isSeries && (
          <div className={styles.section}>
            <span className={styles.sectionLabel}>{recurrenceMessages.applyToTitle}</span>
            <div className={styles.optionRow}>
              <button
                type="button"
                className={`${styles.option} ${!applyToSeries ? styles.optionSelected : ""}`}
                onClick={() => setApplyToSeries(false)}
              >
                <span className={styles.optionTitle}>{recurrenceMessages.editThisOne}</span>
                <span className={styles.optionCheck}>
                  <Icon name="check" size={12} />
                </span>
              </button>
              <button
                type="button"
                className={`${styles.option} ${applyToSeries ? styles.optionSelected : ""}`}
                onClick={() => setApplyToSeries(true)}
              >
                <span className={styles.optionTitle}>{recurrenceMessages.editSeries}</span>
                <span className={styles.optionCheck}>
                  <Icon name="check" size={12} />
                </span>
              </button>
            </div>
          </div>
        )}

        <div className={styles.row2}>
          <Input
            label={messages.dateLabel}
            type="date"
            value={date}
            disabled={applyToSeries}
            onChange={(event) => setDate(event.target.value)}
          />
          <Input
            label={messages.timeLabel}
            type="time"
            value={time}
            disabled={applyToSeries}
            onChange={(event) => setTime(event.target.value)}
          />
        </div>

        <div className={styles.row2}>
          <div className={styles.field}>
            <label className={styles.label}>{messages.durationLabel}</label>
            <select
              className={styles.select}
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
            >
              {[15, 30, 45, 60, 90, 120].map((value) => (
                <option key={value} value={value}>
                  {value} min
                </option>
              ))}
            </select>
          </div>
          <Input
            label={messages.priceLabel}
            type="number"
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(Number(event.target.value))}
          />
        </div>

        {conflictMessage && (
          <div className={styles.warningCard}>
            <span className={styles.warningTitle}>
              <Icon name="close" size={14} />
              {conflictMessage.title}
            </span>
            <span className={styles.warningDescription}>{conflictMessage.description}</span>
            {suggestion ? (
              <>
                <span className={styles.warningDescription}>
                  {conflictMessages.suggestedSlot
                    .replace("{date}", suggestion.date)
                    .replace("{time}", suggestion.time)}
                </span>
                <Button size="sm" className={styles.warningAction} onClick={applySuggestion}>
                  {conflictMessages.useSuggested}
                </Button>
              </>
            ) : (
              <span className={styles.warningDescription}>{conflictMessages.noSlotFound}</span>
            )}
          </div>
        )}

        {!isEditing && (
          <div className={styles.section}>
            <span className={styles.sectionLabel}>{messages.recurrenceLabel}</span>
            <select
              className={styles.select}
              value={recurrenceFreq}
              onChange={(event) =>
                setRecurrenceFreq(event.target.value as RecurrenceFrequency | "none")
              }
            >
              <option value="none">{recurrenceMessages.none}</option>
              <option value="weekly">{recurrenceMessages.weekly}</option>
              <option value="biweekly">{recurrenceMessages.biweekly}</option>
              <option value="monthly">{recurrenceMessages.monthly}</option>
              <option value="custom">{recurrenceMessages.custom}</option>
            </select>

            {recurrenceFreq !== "none" && (
              <>
                <div className={styles.recurrenceRow}>
                  {recurrenceFreq === "custom" && (
                    <Input
                      label={`${recurrenceMessages.every} (${recurrenceMessages.days})`}
                      type="number"
                      value={recurrenceIntervalDays}
                      onChange={(event) => setRecurrenceIntervalDays(Number(event.target.value))}
                    />
                  )}
                  <Input
                    label={recurrenceMessages.occurrences}
                    type="number"
                    value={recurrenceCount}
                    onChange={(event) => setRecurrenceCount(Number(event.target.value))}
                  />
                </div>
                <span className={styles.recurrencePreview}>
                  {recurrencePreviewDates.join(" · ")}
                </span>
              </>
            )}
          </div>
        )}

        <div className={styles.field}>
          <label className={styles.label}>{messages.notesLabel}</label>
          <textarea
            className={styles.textarea}
            placeholder={messages.notesPlaceholder}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        <div className={styles.section}>
          <span className={styles.sectionLabel}>{messages.statusLabel}</span>
          <div className={styles.statusRow}>
            {statusOrder.map((value) => (
              <button
                key={value}
                type="button"
                className={`${styles.statusChip} ${status === value ? styles.statusChipActive : ""}`}
                onClick={() => setStatus(value)}
              >
                {statusMessages[value]}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <span className={styles.sectionLabel}>{messages.visibilityLabel}</span>
          <span className={styles.sectionHint}>{messages.visibilitySectionHint}</span>
          <div className={styles.optionRow}>
            {visibilityOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${styles.option} ${visibility === option.value ? styles.optionSelected : ""}`}
                onClick={() => setVisibility(option.value)}
              >
                <span className={styles.optionBody}>
                  <span className={styles.optionTitle}>{option.title}</span>
                  <span className={styles.optionHint}>{option.hint}</span>
                </span>
                <span className={styles.optionCheck}>
                  <Icon name="check" size={12} />
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <span className={styles.sectionLabel}>{messages.financialBucketLabel}</span>
          <span className={styles.sectionHint}>{messages.financialBucketSectionHint}</span>
          <div className={styles.optionRow}>
            {bucketOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${styles.option} ${financialBucket === option.value ? styles.optionSelected : ""}`}
                onClick={() => setFinancialBucket(option.value)}
              >
                <span className={styles.optionBody}>
                  <span className={styles.optionTitle}>{option.title}</span>
                </span>
                <span className={styles.optionCheck}>
                  <Icon name="check" size={12} />
                </span>
              </button>
            ))}
          </div>
          <span className={styles.separationNote}>{messages.separationNote}</span>
        </div>

        {(validationError || saveError) && (
          <div className={styles.warningCard}>
            <span className={styles.warningTitle}>
              <Icon name="close" size={14} />
              {validationError ? messages.validationRequired : messages.saveError}
            </span>
          </div>
        )}

        <div className={styles.actions}>
          {isEditing && onDelete ? (
            <Button variant="secondary" className={styles.deleteButton} onClick={onDelete}>
              {messages.delete}
            </Button>
          ) : null}
          <Button fullWidth onClick={handleSave} disabled={saving}>
            {messages.save}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
