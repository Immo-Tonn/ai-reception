import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getWorkspaceConfig, isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { demoWorkingHours } from "@/features/workingHours/demoData";
import { weeklyFromSchedule } from "@/features/scheduling/weeklyEdit";
import type { TimeOffEntry, WeeklyIntervals } from "@/features/scheduling/types";
import { getSession } from "@/server/auth/session";
import { resolveToday } from "@/lib/time/zonedTime";
import { getWorkspaceTimeZone } from "@/server/services/finance.service";
import { getWorkingHours, listTimeOff } from "@/server/services/workingHours.service";
import { getBusinessName } from "@/server/services/schedulingShared";
import { HoursView } from "./HoursView";

export default async function HoursPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { hoursSettings, repositoryErrors, common } = getMessages(locale);
  // Business day = the WORKSPACE's calendar day (set below for real workspaces), never the UTC date.
  let today = resolveToday(new Date(), null);

  let businessName: string;
  let weekly: WeeklyIntervals;
  let closures: TimeOffEntry[];
  const readOnly = isDemoWorkspaceSlug(workspaceSlug);
  if (readOnly) {
    // Demo: the shared demo schedule, read-only. Nothing is written, nothing is read from a database.
    businessName = getWorkspaceConfig(workspaceSlug).name;
    weekly = weeklyFromSchedule(demoWorkingHours.find((p) => p.ownerId === "business")?.weekly ?? {});
    closures = [];
  } else {
    try {
      const session = await getSession(workspaceSlug);
      today = resolveToday(new Date(), await getWorkspaceTimeZone(session));
      [businessName, weekly, closures] = await Promise.all([
        getBusinessName(session),
        getWorkingHours(session).then((s) => s.business),
        listTimeOff(session),
      ]);
    } catch {
      notFound(); // not permitted or unknown: do not reveal which
    }
  }

  return (
    <HoursView
      workspaceSlug={workspaceSlug}
      businessName={businessName}
      initialWeekly={weekly}
      initialClosures={closures}
      readOnly={readOnly}
      messages={hoursSettings}
      errors={repositoryErrors}
      backLabel={common.back}
      statusLabels={common.saveStatus}
      today={today}
    />
  );
}
