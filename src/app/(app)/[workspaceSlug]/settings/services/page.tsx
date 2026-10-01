import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { listServicesAction } from "@/server/actions/services.actions";
import { ServicesView } from "./ServicesView";

export default async function SettingsServicesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { settingsServices, common } = getMessages(locale);
  const initialServices = await listServicesAction(workspaceSlug);

  return (
    <ServicesView
      workspaceSlug={workspaceSlug}
      initialServices={initialServices}
      messages={settingsServices}
      backLabel={common.back}
    />
  );
}
