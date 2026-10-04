import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getSession } from "@/server/auth/session";
import { getServerStaffRepository } from "@/server/repository/registry";
import { listServicesAction } from "@/server/actions/services.actions";
import { ServicesView } from "./ServicesView";

export default async function SettingsServicesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  // Demo workspaces have fixed preset services; only real workspaces manage their own.
  if (isDemoWorkspaceSlug(workspaceSlug)) notFound();

  const locale = await getRequestLocale();
  const { settingsServices, servicesSettings, repositoryErrors, common } = getMessages(locale);
  const result = await listServicesAction(workspaceSlug);
  if (!result.ok) notFound();
  const staff = (await getServerStaffRepository((await getSession(workspaceSlug)).workspaceId).list()).map((s) => ({
    id: s.id,
    name: s.name,
  }));

  return (
    <ServicesView
      workspaceSlug={workspaceSlug}
      initialServices={result.data}
      staff={staff}
      messages={settingsServices}
      extra={servicesSettings}
      errors={repositoryErrors}
      backLabel={common.back}
      statusLabels={common.saveStatus}
    />
  );
}
