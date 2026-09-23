import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { InboxView } from "./InboxView";

export default async function InboxPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { inbox } = getMessages(locale);

  return <InboxView workspaceSlug={workspaceSlug} locale={locale} messages={inbox} />;
}
