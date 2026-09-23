import { Sidebar } from "@/components/layout/Sidebar/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav/BottomNav";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { WorkspaceSwitcher } from "@/components/layout/WorkspaceSwitcher/WorkspaceSwitcher";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import styles from "./layout.module.css";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { nav, common, quickCreate } = getMessages(locale);

  return (
    <div className={styles.shell}>
      <Sidebar workspaceSlug={workspaceSlug} messages={nav} appName={common.appName} />
      <div className={styles.content}>
        <div className={styles.topBar}>
          <WorkspaceSwitcher currentSlug={workspaceSlug} />
          <Preferences />
        </div>
        {children}
      </div>
      <BottomNav workspaceSlug={workspaceSlug} nav={nav} quickCreate={quickCreate} />
    </div>
  );
}
