import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getWorkspaceConfig, isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { demoWorkingHours } from "@/features/workingHours/demoData";
import { weeklyFromSchedule } from "@/features/scheduling/weeklyEdit";
import type { StaffRecord, TimeOffEntry, WeeklyIntervals } from "@/features/scheduling/types";
import { getSession } from "@/server/auth/session";
import { resolveToday } from "@/lib/time/zonedTime";
import { getWorkspaceTimeZone } from "@/server/services/finance.service";
import { listServiceOptions, listStaffAdmin, type ServiceOption } from "@/server/services/staffAdmin.service";
import { getWorkingHours, listTimeOff } from "@/server/services/workingHours.service";
import { getBusinessName } from "@/server/services/schedulingShared";
import { StaffView } from "./StaffView";

export default async function StaffPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { staffSettings, hoursSettings, repositoryErrors, common } = getMessages(locale);
  // Business day = the WORKSPACE's calendar day (set below for real workspaces), never the UTC date.
  let today = resolveToday(new Date(), null);
  const readOnly = isDemoWorkspaceSlug(workspaceSlug);

  let businessName: string;
  let staff: StaffRecord[];
  let services: ServiceOption[];
  let business: WeeklyIntervals;
  let staffWeekly: Record<string, WeeklyIntervals>;
  let timeOff: TimeOffEntry[];

  if (readOnly) {
    const config = getWorkspaceConfig(workspaceSlug);
    businessName = config.name;
    staff = config.staff.map((m, i) => ({
      id: m.id,
      name: m.name,
      title: "",
      active: true,
      sortOrder: i * 10,
      colorToken: m.colorToken,
      scheduleMode: "inherit",
      serviceIds: config.services.filter((s) => s.allowedStaffIds.includes(m.id)).map((s) => s.id),
      profileId: null,
    }));
    services = config.services.map((s) => ({ id: s.id, name: s.translations?.[locale] ?? s.name, active: s.active !== false, requiredResourceType: s.requiredResourceType ?? null }));
    business = weeklyFromSchedule(demoWorkingHours.find((p) => p.ownerId === "business")?.weekly ?? {});
    staffWeekly = {};
    timeOff = [];
  } else {
    try {
      const session = await getSession(workspaceSlug);
      today = resolveToday(new Date(), await getWorkspaceTimeZone(session));
      const [name, list, options, hours, off] = await Promise.all([
        getBusinessName(session),
        listStaffAdmin(session),
        listServiceOptions(session),
        getWorkingHours(session),
        listTimeOff(session),
      ]);
      businessName = name;
      staff = list;
      services = options;
      business = hours.business;
      staffWeekly = hours.staff;
      timeOff = off;
    } catch {
      notFound();
    }
  }

  return (
    <StaffView
      workspaceSlug={workspaceSlug}
      businessName={businessName}
      initialStaff={staff}
      services={services}
      businessWeekly={business}
      staffWeekly={staffWeekly}
      initialTimeOff={timeOff}
      readOnly={readOnly}
      messages={staffSettings}
      hours={hoursSettings}
      errors={repositoryErrors}
      backLabel={common.back}
      statusLabels={common.saveStatus}
      today={today}
    />
  );
}
