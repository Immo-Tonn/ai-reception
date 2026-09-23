import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { ClientsView } from "./ClientsView";

export default async function ClientsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { clients } = getMessages(locale);

  return <ClientsView workspaceSlug={workspaceSlug} locale={locale} messages={clients} />;
}
