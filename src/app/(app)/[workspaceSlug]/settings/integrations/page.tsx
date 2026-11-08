import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getWorkspaceConfig, isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getSession } from "@/server/auth/session";
import { getBusinessProfile } from "@/server/services/businessProfile.service";
import { getCalendarSettingsData, type CalendarSettingsData } from "@/server/services/externalCalendarSettings.service";
import { ExternalCalendarError } from "@/server/externalCalendar/service";
import { IntegrationsView } from "./IntegrationsView";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { calendarIntegration, common, bookingSettings } = getMessages(locale);

  const demo = isDemoWorkspaceSlug(workspaceSlug);
  let data: CalendarSettingsData | null = null;
  let businessName: string;
  let forbidden = false;
  if (demo) {
    businessName = getWorkspaceConfig(workspaceSlug).name;
  } else {
    let session;
    try {
      session = await getSession(workspaceSlug);
    } catch {
      notFound();
    }
    businessName = (await getBusinessProfile(session).catch(() => null))?.name ?? "";
    try {
      data = await getCalendarSettingsData(session);
    } catch (error) {
      if (error instanceof ExternalCalendarError && error.code === "forbidden") forbidden = true;
      else throw error;
    }
  }

  return (
    <IntegrationsView
      workspaceSlug={workspaceSlug}
      businessName={businessName}
      locale={locale}
      demo={demo}
      forbidden={forbidden}
      data={data}
      messages={calendarIntegration}
      backLabel={common.back}
      discard={bookingSettings}
    />
  );
}
