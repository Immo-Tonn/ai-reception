import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getSession } from "@/server/auth/session";
import { AccountView } from "./AccountView";

export default async function SettingsAccountPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  // Demo workspaces have no real account behind them.
  if (isDemoWorkspaceSlug(workspaceSlug)) notFound();
  try {
    await getSession(workspaceSlug);
  } catch {
    notFound();
  }

  const locale = await getRequestLocale();
  const { settingsAccount, authErrors, common } = getMessages(locale);

  return (
    <AccountView
      workspaceSlug={workspaceSlug}
      messages={settingsAccount}
      errors={authErrors}
      passwordLabels={{ show: common.showPassword, hide: common.hidePassword }}
      backLabel={common.back}
    />
  );
}
