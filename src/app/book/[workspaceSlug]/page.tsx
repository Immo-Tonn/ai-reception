import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { loadPublicPageData } from "@/server/booking/pageData";
import { LanguageSwitcher } from "@/components/ui";
import { PublicFooter } from "@/components/layout/PublicFooter/PublicFooter";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getCurrentUserSafe } from "@/server/auth/supabaseBusinessAuth";
import { isClientCalendarConnected } from "@/server/clientAccount/pageData";
import { BookingWizard } from "./BookingWizard";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Book an appointment — ServiceOS",
};

export default async function PublicBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { workspaceSlug } = await params;
  // "Back to all businesses" only for visitors who came from the ServiceOS list.
  const cameFromList = (await searchParams).from === "client";
  const locale = await getRequestLocale();
  const { booking, client } = getMessages(locale);
  // Unknown slug = 404 inside (never another business's catalog).
  const { branding, services, staff, profile, timezone } = await loadPublicPageData(workspaceSlug);
  // A signed-in client whose calendar already subscribes gets "it will appear automatically"
  // instead of "add to calendar" buttons (no duplicates). Anonymous visitors: false.
  const user = isSupabaseConfigured() ? await getCurrentUserSafe() : null;
  const calendarConnected = user ? await isClientCalendarConnected(user.id) : false;

  return (
    <div className={styles.page}>
      <BookingWizard
        workspaceSlug={workspaceSlug}
        locale={locale}
        booking={booking}
        client={client}
        branding={branding}
        profile={profile}
        timezone={timezone ?? null}
        services={services}
        staffList={staff}
        backToBusinessesHref={cameFromList ? "/client/book" : null}
        calendarConnected={calendarConnected}
        // One compact header row: language only (the theme follows the device).
        headerActions={<LanguageSwitcher currentLocale={locale} />}
      />
      <PublicFooter />
    </div>
  );
}
