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
 * booking engine, same server actions as the standalone page — only the
 * header/footer chrome differs, controlled by the `chromeless` prop.
 */
export default async function EmbeddedBookingPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { booking } = getMessages(locale);
  const branding = getWorkspaceBranding(workspaceSlug);

  return (
    <BookingWizard
      workspaceSlug={workspaceSlug}
      locale={locale}
      booking={booking}
      branding={branding}
      chromeless
    />
  );
}
