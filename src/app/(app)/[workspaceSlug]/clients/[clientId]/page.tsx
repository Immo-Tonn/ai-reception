import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getSession } from "@/server/auth/session";
import { can } from "@/server/permissions/roles";
import { ClientDetailView } from "./ClientDetailView";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; clientId: string }>;
}) {
  const { workspaceSlug, clientId } = await params;
  const locale = await getRequestLocale();
  const { clients, crossModule, appointmentStatus } = getMessages(locale);
  // Only shows / hides the anonymise button; the action and the database enforce it.
  let canErase = false;
  try {
    canErase = can((await getSession(workspaceSlug)).role, "clients.erase");
  } catch {
    canErase = false;
  }

  return (
    <ClientDetailView
      workspaceSlug={workspaceSlug}
      clientId={clientId}
      locale={locale}
      messages={clients}
      crossModule={crossModule}
      statusMessages={appointmentStatus}
      canErase={canErase}
    />
  );
}
