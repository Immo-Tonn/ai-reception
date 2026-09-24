import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { BookingsView } from "./BookingsView";

export const metadata: Metadata = {
  title: "My bookings — ServiceOS",
};

export default async function ClientBookingsPage() {
  const locale = await getRequestLocale();
  const { common, client, appointmentStatus } = getMessages(locale);

  return (
    <BookingsView
      locale={locale}
      client={client}
      appointmentStatus={appointmentStatus}
      youLabel={common.you}
    />
  );
}
