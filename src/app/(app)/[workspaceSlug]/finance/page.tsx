import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { FinanceView } from "./FinanceView";

export default async function FinancePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { finance, appointment } = getMessages(locale);

  return (
    <FinanceView
      workspaceSlug={workspaceSlug}
      locale={locale}
      messages={finance}
      appointmentMessages={appointment}
    />
  );
}
