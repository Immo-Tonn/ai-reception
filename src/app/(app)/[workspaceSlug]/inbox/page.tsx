import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { InboxView } from "./InboxView";
import { InboxEventsView } from "./InboxEventsView";

export default async function InboxPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { inbox } = getMessages(locale);

  // Real workspaces: business events from the database. The Conversation UI (WhatsApp/e-mail mock-ups) is demo-only.
  if (!isDemoWorkspaceSlug(workspaceSlug)) {
    return <InboxEventsView workspaceSlug={workspaceSlug} locale={locale} messages={inbox} />;
  }
  return <InboxView workspaceSlug={workspaceSlug} locale={locale} messages={inbox} />;
}
