import { notFound, redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav/BottomNav";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { WorkspaceSwitcher } from "@/components/layout/WorkspaceSwitcher/WorkspaceSwitcher";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSession, UnauthenticatedError, WorkspaceAccessError } from "@/server/auth/session";
import { loadWorkspaceCatalog } from "@/server/services/workspaceCatalog.service";
import { WorkspaceCatalogProvider, type WorkspaceCatalogData } from "@/features/workspace/WorkspaceCatalog";
import styles from "./layout.module.css";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const isDemo = isDemoWorkspaceSlug(workspaceSlug);

  // Demo workspaces are public. A real workspace is only for its signed-in
  // members: not signed in -> /login; signed in but not a member, unknown
  // slug, or Supabase not configured -> 404 (never confirm it exists).
  let catalog: WorkspaceCatalogData | null = null;
  if (!isDemo) {
    if (!isSupabaseConfigured()) notFound();
    let failure: "signin" | "missing" | null = null;
    try {
      const session = await getSession(workspaceSlug);
      catalog = await loadWorkspaceCatalog(session, workspaceSlug);
    } catch (error) {
      if (error instanceof UnauthenticatedError) failure = "signin";
      else if (error instanceof WorkspaceAccessError) failure = "missing";
      else throw error;
    }
    if (failure === "signin") redirect("/login");
    if (failure === "missing") notFound();
  }

  const locale = await getRequestLocale();
  const { nav, common, quickCreate, workspaceNotice } = getMessages(locale);

  const shell = (
    <div className={styles.shell}>
      <Sidebar workspaceSlug={workspaceSlug} locale={locale} messages={nav} appName={common.appName} />
      <div className={styles.content}>
        <div className={styles.topBar}>
          <WorkspaceSwitcher currentSlug={workspaceSlug} />
          <Preferences />
        </div>
        {!isDemo && (
          <p className={styles.localOnlyNotice} role="note">
            {workspaceNotice.localOnly}
          </p>
        )}
        {children}
      </div>
      <BottomNav workspaceSlug={workspaceSlug} nav={nav} quickCreate={quickCreate} />
    </div>
  );

  return catalog ? <WorkspaceCatalogProvider value={catalog}>{shell}</WorkspaceCatalogProvider> : shell;
}
