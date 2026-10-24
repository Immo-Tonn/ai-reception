import { getMessages } from "@/lib/i18n";
import { MobileBackToMore } from "@/components/layout/MobileBackToMore/MobileBackToMore";
import { getRequestLocale } from "@/lib/i18n/next";
import { AssistantView } from "./AssistantView";

export default async function AssistantPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { assistant, nav } = getMessages(locale);

  return (
    <>
      <MobileBackToMore workspaceSlug={workspaceSlug} label={nav.more} />
      <AssistantView workspaceSlug={workspaceSlug} messages={assistant} />
    </>
  );
}
