import { getRequestLocale } from "@/lib/i18n/next";
import { PublicFooterView } from "./PublicFooterView";

/**
 * Small legal footer for public / auth / client-facing screens ONLY
 * (never the business app: Calendar, Clients, Finance, Work, ...; never the
 * embeddable booking widget). Place it as the last child of the screen's
 * flex-column container; it pins itself to the bottom of short pages.
 */
export async function PublicFooter() {
  const locale = await getRequestLocale();
  // Copyright year at render time (server clock, UTC) — never hard-coded.
  return <PublicFooterView locale={locale} year={new Date().getUTCFullYear()} />;
}
