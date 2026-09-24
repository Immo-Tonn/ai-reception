import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { CalendarView } from "./CalendarView";

export default async function CalendarPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
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
    />
  );
}
