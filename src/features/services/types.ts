import type { Locale } from "@/lib/i18n/locales";

export interface ServiceDefinition {
  id: string;
  /** Canonical/fallback label — also what `Appointment.service` currently
   * stores as free text, so it must stay stable even where `translations`
   * covers every locale. */
  name: string;
  /** Per-locale display label for this workspace's own catalog. Business
   * data (a workspace's own services), not app-chrome copy — deliberately
   * kept off the `Messages`/i18n layer (see data/en.ts), which is
   * reserved for interface text, never content a business enters. */
  translations?: Partial<Record<Locale, string>>;
  durationMinutes: number;
  price: number;
  currency: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  allowedStaffIds: string[]; // empty = all staff allowed
  requiredResourceType: string | null; // e.g. "room" — null = no resource needed
}
