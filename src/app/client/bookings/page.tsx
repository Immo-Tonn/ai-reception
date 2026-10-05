import Link from "next/link";
import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { loadMyBookingsForPage } from "@/server/actions/clientAccount.actions";
import { BookingsView } from "./BookingsView";
import { DemoBookingsView } from "./DemoBookingsView";
import styles from "./BookingsView.module.css";

export const metadata: Metadata = {
  title: "My bookings — ServiceOS",
};

export default async function ClientBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const locale = await getRequestLocale();
  const { client, appointmentStatus } = getMessages(locale);

  // Browser-local demo bookings: only behind the explicit ?demo=1 entry, never mixed with real ones.
  if ((await searchParams).demo === "1") {
    return (
      <DemoBookingsView locale={locale} client={client} appointmentStatus={appointmentStatus} />
    );
  }

  const data = await loadMyBookingsForPage();

  if (data.state === "unconfigured") {
    return (
      <main className={styles.screen}>
        <div className={styles.body}>
          <h1 className={styles.title}>{client.myBookingsTitle}</h1>
          <div className={styles.signInPrompt}>
            <p>{client.accountsUnavailable}</p>
            <Link href="/client/bookings?demo=1" className={styles.secondaryLink}>
              {client.openDemoBookings}
            </Link>
          </div>
          <Link href="/client" className={styles.backLink}>
            {client.backToHome}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <BookingsView
      locale={locale}
      client={client}
      appointmentStatus={appointmentStatus}
      state={data.state}
      bookings={data.bookings}
      hasPendingClaims={data.hasPendingClaims}
      email={data.email}
    />
  );
}
