import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getWorkspaceBranding } from "@/features/branding/demoData";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { BookingWizard } from "./BookingWizard";

export const metadata: Metadata = {
  title: "Book an appointment — ServiceOS",
};

export default async function PublicBookingPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { common, booking, client } = getMessages(locale);
  const branding = getWorkspaceBranding(workspaceSlug);

  return (
    <BookingWizard
      workspaceSlug={workspaceSlug}
      locale={locale}
      booking={booking}
      client={client}
      branding={branding}
      youLabel={common.you}
      headerActions={<Preferences />}
    />
  );
}
