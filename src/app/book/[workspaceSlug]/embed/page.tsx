import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getWorkspaceBranding } from "@/features/branding/demoData";
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
  const branding = getWorkspaceBranding(workspaceSlug);

  return (
    <BookingWizard
      workspaceSlug={workspaceSlug}
      locale={locale}
      booking={booking}
      client={client}
      branding={branding}
      youLabel={common.you}
      chromeless
    />
  );
}
