import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { AssistantView } from "./AssistantView";

export default async function AssistantPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { assistant } = getMessages(locale);

  return <AssistantView workspaceSlug={workspaceSlug} messages={assistant} />;
}
