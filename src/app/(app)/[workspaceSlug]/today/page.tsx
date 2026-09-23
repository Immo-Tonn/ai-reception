import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { TodayView } from "./TodayView";

export default async function TodayPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { dashboard } = getMessages(locale);

  return <TodayView workspaceSlug={workspaceSlug} locale={locale} dashboard={dashboard} />;
}
