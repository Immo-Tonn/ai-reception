import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getWorkspaceConfig, isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { defaultBookingRules, type BookingRules } from "@/features/scheduling/types";
import { getSession } from "@/server/auth/session";
import { getBookingRules } from "@/server/services/bookingRules.service";
import { BookingView } from "./BookingView";

export default async function BookingRulesPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { bookingSettings, repositoryErrors, common } = getMessages(locale);

  const readOnly = isDemoWorkspaceSlug(workspaceSlug);
  let rules: BookingRules;
  let businessName: string;
  if (readOnly) {
    const config = getWorkspaceConfig(workspaceSlug);
    rules = config.bookingRules ?? defaultBookingRules;
    businessName = config.name;
  } else {
    try {
      const { businessName: name, ...r } = await getBookingRules(await getSession(workspaceSlug));
      rules = r;
      businessName = name;
    } catch {
      notFound();
    }
  }

  return (
    <BookingView
      workspaceSlug={workspaceSlug}
      businessName={businessName}
      initial={rules}
      readOnly={readOnly}
      messages={bookingSettings}
      errors={repositoryErrors}
      backLabel={common.back}
      statusLabels={common.saveStatus}
    />
  );
}
