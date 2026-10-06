import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { loadBookingPageData } from "./loadBookingData";
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
  const data = await loadBookingPageData(workspaceSlug);
  if (!data) notFound();

  return (
    <BookingWizard
      workspaceSlug={workspaceSlug}
      mode={data.mode}
      services={data.services}
      staffList={data.staffList}
      locale={locale}
      booking={booking}
      client={client}
      branding={data.branding}
      youLabel={common.you}
      headerActions={<Preferences />}
    />
  );
}
