import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getSession } from "@/server/auth/session";
import { can } from "@/server/permissions/roles";
import { CalendarView } from "./CalendarView";

export default async function CalendarPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  // Only shows / hides the correction buttons; the service and the database enforce it.
  let canCorrect = false;
  try {
    canCorrect = can((await getSession(workspaceSlug)).role, "appointments.correct");
  } catch {
    canCorrect = false;
  }
  const {
    common,
    calendar,
    appointment,
    dashboard,
    appointmentStatus,
    quickActions,
    move,
    recurrence,
    conflict,
    auditLog,
    repositoryErrors,
  } = getMessages(locale);

  return (
    <CalendarView
      workspaceSlug={workspaceSlug}
      locale={locale}
      common={common}
      calendar={calendar}
      appointment={appointment}
      dashboard={dashboard}
      appointmentStatus={appointmentStatus}
      quickActions={quickActions}
      move={move}
      recurrence={recurrence}
      conflict={conflict}
      auditLog={auditLog}
      repositoryErrors={repositoryErrors}
      canCorrect={canCorrect}
    />
  );
}
