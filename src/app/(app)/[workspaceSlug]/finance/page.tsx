import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getSession } from "@/server/auth/session";
import { getWorkspaceCurrency } from "@/server/services/finance.service";
import { FinanceView } from "./FinanceView";

export default async function FinancePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { finance, appointment, repositoryErrors, common } = getMessages(locale);

  let defaultCurrency = "EUR";
  if (!isDemoWorkspaceSlug(workspaceSlug)) {
    try {
      defaultCurrency = (await getWorkspaceCurrency(await getSession(workspaceSlug))) ?? "EUR";
    } catch {
      notFound();
    }
  }

  return (
    <FinanceView
      workspaceSlug={workspaceSlug}
      locale={locale}
      messages={finance}
      appointmentMessages={appointment}
      errorMessages={repositoryErrors}
      statusLabels={common.saveStatus}
      defaultCurrency={defaultCurrency}
    />
  );
}
