import { getMessages } from "@/lib/i18n";
import { MobileBackToMore } from "@/components/layout/MobileBackToMore/MobileBackToMore";
import { getRequestLocale } from "@/lib/i18n/next";
import { ClientsView } from "./ClientsView";

export default async function ClientsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { clients, nav } = getMessages(locale);

  return (
    <>
      <MobileBackToMore workspaceSlug={workspaceSlug} label={nav.more} />
      <ClientsView workspaceSlug={workspaceSlug} locale={locale} messages={clients} />
    </>
  );
}
