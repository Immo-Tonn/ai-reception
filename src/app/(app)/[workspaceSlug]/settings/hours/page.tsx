import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getBusinessHoursAction } from "@/server/actions/workingHours.actions";
import { HoursView } from "./HoursView";

export default async function SettingsHoursPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { settingsHours, common } = getMessages(locale);
  const initialDays = await getBusinessHoursAction(workspaceSlug);

  return (
    <HoursView
      workspaceSlug={workspaceSlug}
      initialDays={initialDays}
      messages={settingsHours}
      backLabel={common.back}
    />
  );
}
