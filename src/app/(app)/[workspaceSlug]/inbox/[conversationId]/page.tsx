import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { ConversationView } from "./ConversationView";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; conversationId: string }>;
}) {
  const { workspaceSlug, conversationId } = await params;
  const locale = await getRequestLocale();
  const { inbox } = getMessages(locale);

  return (
    <ConversationView
      workspaceSlug={workspaceSlug}
      conversationId={conversationId}
      locale={locale}
      messages={inbox}
    />
  );
}
