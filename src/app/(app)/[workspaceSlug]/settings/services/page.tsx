import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
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
  const { settingsServices, common } = getMessages(locale);
  const result = await listServicesAction(workspaceSlug);
  if (!result.ok) notFound();

  return (
    <ServicesView
      workspaceSlug={workspaceSlug}
      initialServices={result.data}
      messages={settingsServices}
      backLabel={common.back}
    />
  );
}
