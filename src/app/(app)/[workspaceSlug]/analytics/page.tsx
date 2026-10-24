import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { MobileBackToMore } from "@/components/layout/MobileBackToMore/MobileBackToMore";
import { isFeatureEnabled } from "@/lib/config/features";
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
  if (!isFeatureEnabled("analytics")) notFound();
  const locale = await getRequestLocale();
  const { analytics, crossModule, nav } = getMessages(locale);
  const back = <MobileBackToMore workspaceSlug={workspaceSlug} label={nav.more} />;

  // Demo workspaces keep the pure calculations on demo data; real workspaces read the database
  // (SECURITY INVOKER aggregate under the viewer's RLS) and never fall back to demo data.
  if (isDemoWorkspaceSlug(workspaceSlug)) {
    return (
      <>
        {back}
        <AnalyticsView workspaceSlug={workspaceSlug} locale={locale} messages={analytics} />
      </>
    );
  }
  return (
    <>
      {back}
      <RealAnalyticsView workspaceSlug={workspaceSlug} locale={locale} messages={analytics} labels={crossModule} />
    </>
  );
}
