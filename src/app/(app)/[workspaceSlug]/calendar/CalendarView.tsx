"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { localIsoDate } from "@/lib/date/localIsoDate";
import { Button, Icon } from "@/components/ui";
import { AppointmentSheet, type AppointmentSaveResult } from "@/components/calendar/AppointmentSheet";
import { QuickActionsSheet } from "@/components/calendar/QuickActionsSheet";
import { MoveAppointmentSheet } from "@/components/calendar/MoveAppointmentSheet";
import { HistorySheet } from "@/components/calendar/HistorySheet";
import { StatusBadge } from "@/components/calendar/StatusBadge";
import { TimeGrid, type TimeGridColumn } from "@/components/calendar/TimeGrid";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { useAppointments } from "@/features/appointments/useAppointments";
import { useAuditLog } from "@/features/auditLog/useAuditLog";
import { useWaitingList } from "@/features/waitingList/useWaitingList";
import { matchWaitingList } from "@/features/waitingList/matching";
import type { Appointment, AppointmentStatus } from "@/features/appointments/types";
import { getWorkspaceConfig } from "@/features/workspace/registry";
import { demoWorkingHours } from "@/features/workingHours/demoData";
import { useClients } from "@/features/clients/useClients";
import type { Locale, Messages } from "@/lib/i18n";
import styles from "./page.module.css";

type DesktopView = "day" | "week" | "month" | "staff";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function startOfWeek(date: string) {
  const d = new Date(date + "T00:00:00");
  const offset = (d.getDay() + 6) % 7; // Monday-first
  d.setDate(d.getDate() - offset);
  return d;
}

// Anchored to the Monday of the selected date's week — not centered on
// the selected date itself — so tapping another day in the SAME week
// only toggles which chip is active instead of shifting/remounting the
// whole strip (that recenter-every-tap was the "flash" on day switch).
function buildWeekStrip(centerDate: string) {
  const start = startOfWeek(centerDate);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return localIsoDate(day);
  });
}

export function CalendarView({
  workspaceSlug,
  locale,
  calendar,
  appointment,
  dashboard,
  appointmentStatus,
  quickActions,
  move,
  recurrence,
  conflict,
  auditLog,
}: {
  workspaceSlug: string;
  locale: Locale;
  calendar: Messages["calendar"];
  appointment: Messages["appointment"];
  dashboard: Messages["dashboard"];
  appointmentStatus: Messages["appointmentStatus"];
  quickActions: Messages["quickActions"];
  move: Messages["move"];
  recurrence: Messages["recurrence"];
  auditLog: Messages["auditLog"];
  conflict: Messages["conflict"];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The one Calendar/Appointment engine, configured per industry — see
  // src/features/workspace. Swapping `/demo-salon` for `/demo-werkstatt`
  // changes only this lookup's result, never the components below it.
  const workspace = useMemo(() => getWorkspaceConfig(workspaceSlug), [workspaceSlug]);
  const demoServices = workspace.services;
  const demoStaff = workspace.staff;
  const demoResources = workspace.resources;

  const { items: appointments, create, update, remove } = useAppointments(workspaceSlug);
  const { log, entries: auditEntries } = useAuditLog(workspaceSlug);
  const { items: waitingListEntries } = useWaitingList(workspaceSlug);
  const { items: clients, create: createClient } = useClients(workspaceSlug);

  const [selectedDate, setSelectedDate] = useState("2026-09-22");
  const [staffFilter, setStaffFilter] = useState<string>("all");
  const [desktopView, setDesktopView] = useState<DesktopView>("day");

  const [editing, setEditing] = useState<Appointment | null>(null);
  const [sheetOpen, setSheetOpen] = useState(searchParams.get("create") === "appointment");
  const prefillClient = searchParams.get("client") ?? "";

  // Store only the id and derive the live object from `appointments` on
  // every render — holding the Appointment object itself would freeze a
  // stale snapshot in the sheet after a status change, move, etc.
  const [quickActionsTargetId, setQuickActionsTargetId] = useState<string | null>(null);
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
  const [lastCancelMatchCount, setLastCancelMatchCount] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);

  const quickActionsTarget = appointments.find((a) => a.id === quickActionsTargetId) ?? null;
  const moveTarget = appointments.find((a) => a.id === moveTargetId) ?? null;

  const weekStrip = useMemo(() => buildWeekStrip(selectedDate), [selectedDate]);
  const staffList = useMemo(
    () => Array.from(new Set(appointments.map((item) => item.staff))),
    [appointments],
  );

  const dayAppointments = appointments
    .filter((item) => item.date === selectedDate)
    .filter((item) => staffFilter === "all" || item.staff === staffFilter)
    .sort((a, b) => a.time.localeCompare(b.time));

  function openCreate() {
    setEditing(null);
    setSheetOpen(true);
  }

  function openEdit(item: Appointment) {
    setEditing(item);
    setSheetOpen(true);
    setQuickActionsTargetId(null);
  }

  function closeSheet() {
    setSheetOpen(false);
    if (searchParams.get("create")) {
      router.replace(`/${workspaceSlug}/calendar`);
    }
  }

  async function handleSave(result: AppointmentSaveResult) {
    if (result.mode === "create") {
      for (const appt of result.appointments) {
        await create(appt);
        log({
          action: "created",
          entityType: "appointment",
          entityId: appt.id,
          summary: `${appt.client} · ${appt.service} · ${appt.date} ${appt.time}`,
          source: "user",
        });
      }
      return;
    }

    if (result.mode === "updateOne") {
      const before = appointments.find((a) => a.id === result.id);
      await update(result.id, result.patch);
      const statusChanged =
        before && result.patch.status && result.patch.status !== before.status;
      const summary = statusChanged
        ? auditLog.statusChanged.replace(
            "{status}",
            appointmentStatus[result.patch.status as AppointmentStatus],
          )
        : `${auditLog.updated}: ${result.patch.client ?? before?.client ?? ""}`;
      log({
        action: statusChanged ? "statusChanged" : "updated",
        entityType: "appointment",
        entityId: result.id,
        summary,
        source: "user",
      });
      return;
    }

    if (result.mode === "updateSeries") {
      const targets = appointments.filter(
        (a) => a.seriesId === result.seriesId && a.date >= result.fromDate,
      );
      for (const target of targets) {
        await update(target.id, result.patch);
      }
      log({
        action: "updated",
        entityType: "appointment",
        entityId: result.seriesId,
        summary: `${targets.length} appointments in series updated`,
        source: "user",
      });
    }
  }

  async function handleDelete() {
    if (!editing) return;
    await remove(editing.id);
    log({
      action: "deleted",
      entityType: "appointment",
      entityId: editing.id,
      summary: `${editing.client} · ${editing.service}`,
      source: "user",
    });
    setSheetOpen(false);
  }

  async function handleSetStatus(appt: Appointment, status: AppointmentStatus) {
    await update(appt.id, { status });
    log({
      action: status === "cancelled" ? "cancelled" : "statusChanged",
      entityType: "appointment",
      entityId: appt.id,
      summary:
        status === "cancelled"
          ? `${auditLog.cancelled}: ${appt.client}`
          : auditLog.statusChanged.replace("{status}", appointmentStatus[status]),
      source: "user",
    });
  }

  async function handleConfirmCancel(appt: Appointment) {
    const matches = matchWaitingList(appt, waitingListEntries);
    setLastCancelMatchCount(matches.length);
    await handleSetStatus(appt, "cancelled");
  }

  async function handleTogglePaid(appt: Appointment) {
    await update(appt.id, { paid: !appt.paid });
    log({
      action: "updated",
      entityType: "appointment",
      entityId: appt.id,
      summary: `${appt.client}: ${!appt.paid ? quickActions.markPaid : quickActions.markUnpaid}`,
      source: "user",
    });
  }

  function handleOpenClient(appt: Appointment) {
    const client = clients.find((c) => c.name === appt.client);
    router.push(client ? `/${workspaceSlug}/clients/${client.id}` : `/${workspaceSlug}/clients`);
  }

  async function handleMoveConfirm(appt: Appointment, date: string, time: string) {
    const fromTime = appt.time;
    await update(appt.id, { date, time });
    log({
      action: "moved",
      entityType: "appointment",
      entityId: appt.id,
      summary: `${appt.client}: ${auditLog.moved.replace("{fromTime}", fromTime).replace("{toTime}", time)} (${date})`,
      source: "user",
    });
  }

  function renderRow(item: Appointment) {
    const isMasked = item.visibility === "private";
    return (
      <button
        key={item.id}
        type="button"
        className={styles.row}
        onClick={() => setQuickActionsTargetId(item.id)}
      >
        <span className={styles.rowTime}>{item.time}</span>
        <span className={`${styles.rowAvatar} ${isMasked ? styles.rowAvatarMasked : ""}`}>
          {isMasked ? "•" : initials(item.client)}
        </span>
        <span className={styles.rowBody}>
          <span className={styles.rowTitle}>{isMasked ? dashboard.statusBusy : item.client}</span>
          {!isMasked && <span className={styles.rowSubtitle}>{item.service}</span>}
        </span>
        <span className={styles.rowMeta}>
          <span className={styles.rowDuration}>{item.durationMinutes} min</span>
          {isMasked ? (
            <span className={styles.rowDuration}>
              <Icon name="lock" size={11} /> {dashboard.private}
            </span>
          ) : (
            <StatusBadge status={item.status} labels={appointmentStatus} variant="onLight" />
          )}
        </span>
      </button>
    );
  }

  // ---- Desktop: Week view columns ----
  const weekDays = useMemo(() => {
    const start = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return localIsoDate(d);
    });
  }, [selectedDate]);

  const weekColumns: TimeGridColumn[] = weekDays.map((iso) => {
    const d = new Date(iso + "T00:00:00");
    return {
      key: iso,
      // Weekday via the static lookup, not Intl — see the note by
      // `weekdaysShort` in the i18n data files for why.
      label: `${calendar.weekdaysShort[d.getDay()]} ${d.getDate()}`,
      appointments: appointments
        .filter((a) => a.date === iso)
        .filter((a) => staffFilter === "all" || a.staff === staffFilter),
    };
  });

  // ---- Desktop: Staff view columns (single day, one column per staff) ----
  const staffColumns: TimeGridColumn[] = demoStaff.map((s) => ({
    key: s.id,
    label: s.name,
    appointments: appointments.filter((a) => a.date === selectedDate && a.staff === s.name),
  }));

  function shiftDesktopDate(days: number) {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + days);
    setSelectedDate(localIsoDate(d));
  }

  const desktopViewTabs: { key: DesktopView; label: string }[] = [
    { key: "day", label: calendar.dayView },
    { key: "week", label: calendar.weekView },
    { key: "month", label: calendar.monthView },
    { key: "staff", label: calendar.staffView },
  ];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{calendar.title}</h1>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.historyButton}
            onClick={() => setHistoryOpen(true)}
            aria-label={auditLog.title}
          >
            <Icon name="history" size={18} />
          </button>
          <Button className={styles.newButton} onClick={openCreate}>
            {calendar.newAppointment}
          </Button>
        </div>
      </header>

      {/* ---------------- Mobile ---------------- */}
      <div className={styles.mobileOnly}>
        {/* Same Day/Week/Month/Staff switch as desktop — reuses desktopView,
            no separate mobile calendar engine. */}
        <div className={styles.viewSwitcher}>
          {desktopViewTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`${styles.viewTab} ${desktopView === tab.key ? styles.viewTabActive : ""}`}
              onClick={() => setDesktopView(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {desktopView === "day" && (
          <div className={styles.dateStrip}>
            {weekStrip.map((iso) => {
              const date = new Date(iso + "T00:00:00");
              const hasAppointments = appointments.some((item) => item.date === iso);
              const active = iso === selectedDate;
              return (
                <button
                  key={iso}
                  type="button"
                  className={`${styles.dateChip} ${active ? styles.dateChipActive : ""}`}
                  onClick={() => setSelectedDate(iso)}
                >
                  <span className={styles.dateChipWeekday}>
                    {calendar.weekdaysShort[date.getDay()]}
                  </span>
                  <span className={styles.dateChipNum}>{date.getDate()}</span>
                  {hasAppointments ? <span className={styles.dateChipDot} /> : null}
                </button>
              );
            })}
          </div>
        )}

        <div className={styles.staffRow}>
          <button
            type="button"
            className={`${styles.staffChip} ${staffFilter === "all" ? styles.staffChipActive : ""}`}
            onClick={() => setStaffFilter("all")}
          >
            {calendar.filterAllStaff}
          </button>
          {staffList.map((name) => (
            <button
              key={name}
              type="button"
              className={`${styles.staffChip} ${staffFilter === name ? styles.staffChipActive : ""}`}
              onClick={() => setStaffFilter(name)}
            >
              {name}
            </button>
          ))}
        </div>

        {desktopView === "day" &&
          (dayAppointments.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyTitle}>{calendar.noAppointments}</span>
              <span className={styles.emptyHint}>{calendar.noAppointmentsHint}</span>
            </div>
          ) : (
            <div className={styles.list}>{dayAppointments.map(renderRow)}</div>
          ))}

        {desktopView === "week" && (
          <div className={styles.gridScroll}>
            <TimeGrid
              columns={weekColumns}
              dashboardMessages={dashboard}
              onSelect={(a) => setQuickActionsTargetId(a.id)}
            />
          </div>
        )}

        {desktopView === "month" && (
          <MonthGrid
            monthAnchor={selectedDate}
            appointments={appointments.filter(
              (a) => staffFilter === "all" || a.staff === staffFilter,
            )}
            weekdaysShort={calendar.weekdaysShort}
            dashboardMessages={dashboard}
            onSelectDay={(date) => {
              setSelectedDate(date);
              setDesktopView("day");
            }}
          />
        )}

        {desktopView === "staff" && (
          <div className={styles.gridScroll}>
            <TimeGrid
              columns={staffColumns}
              dashboardMessages={dashboard}
              onSelect={(a) => setQuickActionsTargetId(a.id)}
            />
          </div>
        )}
      </div>

      {/* ---------------- Desktop: Day / Week / Month / Staff ---------------- */}
      <div className={styles.desktopOnly}>
        <div className={styles.desktopToolbar}>
          <div className={styles.viewSwitcher}>
            {desktopViewTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`${styles.viewTab} ${desktopView === tab.key ? styles.viewTabActive : ""}`}
                onClick={() => setDesktopView(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className={styles.dateNav}>
            <button
              type="button"
              className={styles.dateNavButton}
              onClick={() => shiftDesktopDate(desktopView === "week" ? -7 : -1)}
              aria-label="Previous"
            >
              <Icon name="chevronRight" size={16} style={{ transform: "rotate(180deg)" }} />
            </button>
            <span className={styles.dateNavLabel}>
              {new Date(selectedDate + "T00:00:00").toLocaleDateString(locale, {
                dateStyle: "long",
              })}
            </span>
            <button
              type="button"
              className={styles.dateNavButton}
              onClick={() => shiftDesktopDate(desktopView === "week" ? 7 : 1)}
              aria-label="Next"
            >
              <Icon name="chevronRight" size={16} />
            </button>
          </div>

          <div className={styles.staffRow} style={{ marginBottom: 0 }}>
            <button
              type="button"
              className={`${styles.staffChip} ${staffFilter === "all" ? styles.staffChipActive : ""}`}
              onClick={() => setStaffFilter("all")}
            >
              {calendar.filterAllStaff}
            </button>
            {staffList.map((name) => (
              <button
                key={name}
                type="button"
                className={`${styles.staffChip} ${staffFilter === name ? styles.staffChipActive : ""}`}
                onClick={() => setStaffFilter(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {desktopView === "day" &&
          (dayAppointments.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyTitle}>{calendar.noAppointments}</span>
              <span className={styles.emptyHint}>{calendar.noAppointmentsHint}</span>
            </div>
          ) : (
            <div className={styles.list}>{dayAppointments.map(renderRow)}</div>
          ))}

        {desktopView === "week" && (
          <TimeGrid
            columns={weekColumns}
            dashboardMessages={dashboard}
            onSelect={(a) => setQuickActionsTargetId(a.id)}
          />
        )}

        {desktopView === "month" && (
          <MonthGrid
            monthAnchor={selectedDate}
            appointments={appointments.filter(
              (a) => staffFilter === "all" || a.staff === staffFilter,
            )}
            weekdaysShort={calendar.weekdaysShort}
            dashboardMessages={dashboard}
            onSelectDay={(date) => {
              setSelectedDate(date);
              setDesktopView("day");
            }}
          />
        )}

        {desktopView === "staff" && (
          <TimeGrid
            columns={staffColumns}
            dashboardMessages={dashboard}
            onSelect={(a) => setQuickActionsTargetId(a.id)}
          />
        )}
      </div>

      <button type="button" className={styles.fab} onClick={openCreate} aria-label={calendar.newAppointment}>
        <Icon name="plus" size={24} />
      </button>

      <AppointmentSheet
        open={sheetOpen}
        onClose={closeSheet}
        onSave={handleSave}
        onDelete={editing ? handleDelete : undefined}
        messages={appointment}
        statusMessages={appointmentStatus}
        conflictMessages={conflict}
        recurrenceMessages={recurrence}
        initialValue={editing}
        defaultDate={selectedDate}
        allAppointments={appointments}
        services={demoServices}
        staffList={demoStaff}
        resources={demoResources}
        workingHours={demoWorkingHours}
        clients={clients}
        onCreateClient={(client) => createClient(client)}
        prefillClient={prefillClient}
        clientLabelOverride={workspace.clientLabel}
        key={editing?.id ?? "create"}
      />

      <QuickActionsSheet
        open={Boolean(quickActionsTarget)}
        onClose={() => setQuickActionsTargetId(null)}
        appointment={quickActionsTarget}
        messages={quickActions}
        statusMessages={appointmentStatus}
        waitingListMatchCount={lastCancelMatchCount}
        onEdit={() => quickActionsTarget && openEdit(quickActionsTarget)}
        onMove={() => {
          if (quickActionsTarget) setMoveTargetId(quickActionsTarget.id);
          setQuickActionsTargetId(null);
        }}
        onSetStatus={(status) => quickActionsTarget && handleSetStatus(quickActionsTarget, status)}
        onTogglePaid={() => quickActionsTarget && handleTogglePaid(quickActionsTarget)}
        onOpenClient={() => quickActionsTarget && handleOpenClient(quickActionsTarget)}
        onConfirmCancel={() => quickActionsTarget && handleConfirmCancel(quickActionsTarget)}
        onViewWaitingList={() => router.push(`/${workspaceSlug}/waiting-list`)}
      />

      <MoveAppointmentSheet
        open={Boolean(moveTarget)}
        onClose={() => setMoveTargetId(null)}
        appointment={moveTarget}
        allAppointments={appointments}
        services={demoServices}
        workingHours={demoWorkingHours}
        messages={move}
        conflictMessages={conflict}
        onConfirm={(date, time) => moveTarget && handleMoveConfirm(moveTarget, date, time)}
        key={moveTarget?.id ?? "move"}
      />

      <HistorySheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        entries={auditEntries}
        locale={locale}
        messages={auditLog}
      />
    </main>
  );
}
