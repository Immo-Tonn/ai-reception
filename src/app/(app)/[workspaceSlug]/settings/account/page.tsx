import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { AccountView } from "./AccountView";

export default async function SettingsAccountPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { settingsAccount, common } = getMessages(locale);

  return (
    <AccountView workspaceSlug={workspaceSlug} messages={settingsAccount} backLabel={common.back} />
  );
}
