import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { ClientDetailView } from "./ClientDetailView";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; clientId: string }>;
}) {
  const { workspaceSlug, clientId } = await params;
  const locale = await getRequestLocale();
  const { clients } = getMessages(locale);

  return (
    <ClientDetailView
      workspaceSlug={workspaceSlug}
      clientId={clientId}
      locale={locale}
      messages={clients}
    />
  );
}
