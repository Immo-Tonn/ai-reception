import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { AnalyticsView } from "./AnalyticsView";
import { RealAnalyticsView } from "./RealAnalyticsView";

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { analytics, crossModule } = getMessages(locale);

  // Demo workspaces keep the pure calculations on demo data; real workspaces read the database
  // (SECURITY INVOKER aggregate under the viewer's RLS) and never fall back to demo data.
  if (isDemoWorkspaceSlug(workspaceSlug)) {
    return <AnalyticsView workspaceSlug={workspaceSlug} locale={locale} messages={analytics} />;
  }
  return <RealAnalyticsView workspaceSlug={workspaceSlug} locale={locale} messages={analytics} labels={crossModule} />;
}
