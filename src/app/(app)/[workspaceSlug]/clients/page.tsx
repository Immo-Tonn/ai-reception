import { getMessages } from "@/lib/i18n";
import { MobileBackToToday } from "@/components/layout/MobileBackToToday/MobileBackToToday";
import { getRequestLocale } from "@/lib/i18n/next";
import { getSession } from "@/server/auth/session";
import { can } from "@/server/permissions/roles";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { ClientsView } from "./ClientsView";

export default async function ClientsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { clients, nav } = getMessages(locale);
  // Only shows / hides the archive switch; the actions and the database enforce it.
  let canArchive = false;
  if (!isDemoWorkspaceSlug(workspaceSlug)) {
    try {
      canArchive = can((await getSession(workspaceSlug)).role, "clients.archive");
    } catch {
      canArchive = false;
    }
  }

  return (
    <>
      <MobileBackToToday workspaceSlug={workspaceSlug} label={nav.today} />
      <ClientsView workspaceSlug={workspaceSlug} locale={locale} messages={clients} canArchive={canArchive} />
    </>
  );
}
