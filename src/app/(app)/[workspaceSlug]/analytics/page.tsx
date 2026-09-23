import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { AnalyticsView } from "./AnalyticsView";

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { analytics } = getMessages(locale);

  return <AnalyticsView workspaceSlug={workspaceSlug} locale={locale} messages={analytics} />;
}
