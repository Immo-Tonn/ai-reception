import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { loadBookingPageData } from "../loadBookingData";
import { BookingWizard } from "../BookingWizard";

export const metadata: Metadata = {
  title: "Book an appointment",
};

/**
 * Chromeless variant for iframe embedding (§3). Same BookingWizard, same
 * client-side booking engine as the standalone page — only the
 * header/footer chrome differs, controlled by the `chromeless` prop.
 */
export default async function EmbeddedBookingPage({
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
      chromeless
    />
  );
}
