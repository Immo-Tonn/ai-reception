import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { WaitingListView } from "./WaitingListView";

export default async function WaitingListPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { common, waitingList } = getMessages(locale);

  return (
    <WaitingListView
      workspaceSlug={workspaceSlug}
      locale={locale}
      messages={waitingList}
      youLabel={common.you}
    />
  );
}
