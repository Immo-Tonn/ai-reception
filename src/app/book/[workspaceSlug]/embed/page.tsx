import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { loadPublicPageData } from "@/server/booking/pageData";
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
  // Unknown slug = 404 inside (never another business's catalog).
  const { branding, services, staff } = await loadPublicPageData(workspaceSlug);

  return (
    <BookingWizard
      workspaceSlug={workspaceSlug}
      locale={locale}
      booking={booking}
      client={client}
      branding={branding}
      services={services}
      staffList={staff}
      youLabel={common.you}
      chromeless
    />
  );
}
