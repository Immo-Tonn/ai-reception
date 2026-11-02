import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { ClientDetailView } from "./ClientDetailView";
import { getExportPermissions } from "./exportPermissions";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; clientId: string }>;
}) {
  const { workspaceSlug, clientId } = await params;
  const exportPermissions = await getExportPermissions(workspaceSlug);
  const locale = await getRequestLocale();
  const { clients, crossModule, appointmentStatus } = getMessages(locale);

  return (
    <ClientDetailView
      workspaceSlug={workspaceSlug}
      exportPermissions={exportPermissions}
      clientId={clientId}
      locale={locale}
      messages={clients}
      crossModule={crossModule}
      statusMessages={appointmentStatus}
    />
  );
}
