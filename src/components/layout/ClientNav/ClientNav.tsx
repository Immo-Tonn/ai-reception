import Link from "next/link";
import { Icon, type IconName } from "@/components/ui";
import { signOutClientAction } from "@/server/actions/clientAccount.actions";
import type { Messages } from "@/lib/i18n";
import styles from "./ClientNav.module.css";

/**
 * Navigation for the client pages (server-renderable; the active item comes
 * from the page via `aria-current="page"`, so no client JS).
 *  - Top row: "← ServiceOS" back to the client home, plus (from 768px) the
 *    links and Sign out.
 *  - Phones: a fixed bottom tab bar (Book · My bookings · Profile), like the
 *    business app. Sign out then lives on the Profile page.
 */
export function ClientNav({
  client,
  active,
  showSignOut = true,
  bookHref = "/client/book",
  bookingsHref = "/client/bookings",
  profileHref = "/client/profile",
  signOut,
}: {
  client: Messages["client"];
  active: "book" | "bookings" | "profile";
  showSignOut?: boolean;
  bookHref?: string;
  bookingsHref?: string;
  /** null = no profile (browser-local demo view). */
  profileHref?: string | null;
  /** Override for the demo view (browser-local sign-out); defaults to the server action. */
  signOut?: () => void;
}) {
  const items: { key: "book" | "bookings" | "profile"; href: string; label: string; icon: IconName }[] = [
    { key: "book", href: bookHref, label: client.navBook, icon: "plus" },
    { key: "bookings", href: bookingsHref, label: client.navBookings, icon: "calendar" },
    ...(profileHref ? [{ key: "profile" as const, href: profileHref, label: client.navProfile, icon: "user" as const }] : []),
  ];

  const signOutButton = showSignOut ? (
    signOut ? (
      <button type="button" className={styles.signOut} onClick={signOut}>
        {client.signOut}
      </button>
    ) : (
      <form action={signOutClientAction} suppressHydrationWarning>
        <button type="submit" className={styles.signOut}>
          {client.signOut}
        </button>
      </form>
    )
  ) : null;

  return (
    <>
      <nav className={styles.nav} aria-label={client.navLabel}>
        <Link href="/client" className={styles.home}>
          <Icon name="arrowLeft" size={16} strokeWidth={1.8} />
          <span>{client.backToHome}</span>
        </Link>
        <div className={styles.links}>
          {items.map((item) => (
            <Link key={item.key} href={item.href} className={styles.link} aria-current={active === item.key ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </div>
        {/* With a Profile page, phones sign out there; the demo view keeps it here. */}
        <div className={profileHref ? styles.signOutWide : undefined}>{signOutButton}</div>
      </nav>

      <nav className={styles.tabBar} aria-label={client.navLabel} data-client-tab-bar="">
        {items.map((item) => (
          <Link key={item.key} href={item.href} className={styles.tab} aria-current={active === item.key ? "page" : undefined}>
            <Icon name={item.icon} size={22} />
            <span className={styles.tabLabel}>{item.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
