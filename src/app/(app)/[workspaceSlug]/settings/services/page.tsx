import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { listServicesAction } from "@/server/actions/services.actions";
import { listStaffAction } from "@/server/actions/staff.actions";
import { ServicesView } from "./ServicesView";

export default async function SettingsServicesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { settingsServices, common } = getMessages(locale);
  const [initialServices, staff] = await Promise.all([
    listServicesAction(workspaceSlug),
    listStaffAction(workspaceSlug),
  ]);

  return (
    <ServicesView
      workspaceSlug={workspaceSlug}
      initialServices={initialServices}
      staff={staff}
      messages={settingsServices}
      backLabel={common.back}
    />
  );
}
