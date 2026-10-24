import { getMessages } from "@/lib/i18n";
import { MobileBackToToday } from "@/components/layout/MobileBackToToday/MobileBackToToday";
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
      <MobileBackToToday workspaceSlug={workspaceSlug} label={nav.today} />
      <AssistantView workspaceSlug={workspaceSlug} messages={assistant} />
    </>
  );
}
