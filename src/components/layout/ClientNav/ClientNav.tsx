import Link from "next/link";
import { signOutClientAction } from "@/server/actions/clientAccount.actions";
import type { Messages } from "@/lib/i18n";
import styles from "./ClientNav.module.css";

/**
 * Compact navigation for the signed-in client pages: Book, My bookings, Sign out.
 * Plain (server-renderable) component: the active item comes from the page that renders it
 * (`aria-current="page"`), so there is no client JS and no hydration difference.
 * No account/profile link: no such page exists.
 */
export function ClientNav({
  client,
  active,
  showSignOut = true,
  bookHref = "/client/book",
  bookingsHref = "/client/bookings",
  signOut,
}: {
  client: Messages["client"];
  active: "book" | "bookings";
  showSignOut?: boolean;
  bookHref?: string;
  bookingsHref?: string;
  /** Override for the demo view (browser-local sign-out); defaults to the server action. */
  signOut?: () => void;
}) {
  return (
    <nav className={styles.nav} aria-label={client.navLabel}>
      <div className={styles.links}>
        <Link href={bookHref} className={styles.link} aria-current={active === "book" ? "page" : undefined}>
          {client.navBook}
        </Link>
        <Link href={bookingsHref} className={styles.link} aria-current={active === "bookings" ? "page" : undefined}>
          {client.navBookings}
        </Link>
      </div>
      {showSignOut ? (
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
      ) : null}
    </nav>
  );
}
