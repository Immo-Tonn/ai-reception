import { getMessages } from "@/lib/i18n";
import { MobileBackToMore } from "@/components/layout/MobileBackToMore/MobileBackToMore";
import { getRequestLocale } from "@/lib/i18n/next";
import { WaitingListView } from "./WaitingListView";

export default async function WaitingListPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { common, waitingList, nav } = getMessages(locale);

  return (
    <>
      <MobileBackToMore workspaceSlug={workspaceSlug} label={nav.more} />
      <WaitingListView
        workspaceSlug={workspaceSlug}
        locale={locale}
        messages={waitingList}
        youLabel={common.you}
        saveLabels={common.saveStatus}
      />
    </>
  );
}
