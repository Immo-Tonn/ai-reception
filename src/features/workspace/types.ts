import type { Appointment } from "@/features/appointments/types";
import type { ClientRecord } from "@/features/clients/types";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import type { ResourceDefinition } from "@/features/resources/types";
import type { Locale } from "@/lib/i18n/locales";

/**
 * One ServiceOS engine (Calendar/Appointments/Clients), many industries.
 * A WorkspaceConfig never changes behavior — only the catalog (services,
 * staff, resources) and demo content a workspace slug seeds its
 * repositories with. Nothing here is a separate data model: Appointment
 * and ClientRecord stay identical across industries, which is what lets
 * the exact same Calendar render "BMW X5 · Ölwechsel" just as naturally
 * as "Anna Müller · Haircut".
 */
export type IndustryKey = "salon" | "werkstatt" | "cleaning" | "consulting";

export interface WorkspaceConfig {
  slug: string;
  industry: IndustryKey;
  /** Display name for the workspace switcher. */
  name: string;
  /** One-line description shown in the switcher. */
  tagline: string;
  /** Emoji shown in the switcher — kept out of the Icon set on purpose,
   * this is demo-only chrome, not a product icon. */
  emoji: string;
  /** Overrides the generic "Client" label where it's shown standalone
   * (ClientPicker) — e.g. "Vehicle" for Werkstatt, "Property" for
   * Cleaning. Falls back to the normal i18n string when unset
   * (salon/consulting keep "Client"). */
  clientLabel?: string;
  /** Plural form of `clientLabel`, for the Clients list title (e.g.
   * "Vehicles", "Properties") — kept as its own field instead of
   * naively appending "s" so the grammar stays correct. */
  clientLabelPlural?: string;
  /** Localized override for the Staff/Specialist field label — e.g.
   * "Mechanic" for Werkstatt, "Consultant" for Consulting. Falls back to
   * the generic i18n "Staff" string per locale when unset. */
  staffLabel?: Partial<Record<Locale, string>>;
  /** Localized override for the Resource field label — e.g.
   * "Bay / lift" for Werkstatt. Falls back to the generic i18n
   * "Resource" string per locale when unset. */
  resourceLabel?: Partial<Record<Locale, string>>;
  /** Localized override for the "no resource needed" option text,
   * paired with `resourceLabel`. Falls back to the generic i18n string
   * per locale when unset. */
  noResourceLabel?: Partial<Record<Locale, string>>;
  /** Whether Work (Leads/Quotes/Jobs/Projects) shows as a main nav item
   * for this workspace — the `/work` route itself is never removed, this
   * only controls navigation visibility. Defaults to `true` when unset
   * (Werkstatt/Cleaning/Consulting all use it; a simple Salon doesn't
   * need a lead-to-invoice pipeline for a walk-in haircut). */
  workEnabled?: boolean;
  /** Localized override for the Work nav label/page title — e.g.
   * "Jobs" for Werkstatt/Cleaning, "Projects" for Consulting. Falls back
   * to the generic i18n "Work" string per locale when unset. Same one
   * Work engine underneath regardless of label (§ no second engine). */
  workLabel?: Partial<Record<Locale, string>>;
  /** Short, industry-specific context line shown under the Work page
   * title — explains what the Leads→Quotes→Jobs/Projects→Invoice
   * pipeline means for THIS business, not a generic tutorial. */
  workIntro?: Partial<Record<Locale, string>>;
  /** Short context line shown under the Finance page title. */
  financeIntro?: Partial<Record<Locale, string>>;
  /** Short context line shown under the Analytics page title — must only
   * mention data this workspace actually has (e.g. never "orders" for a
   * workspace with `workEnabled: false`). */
  analyticsIntro?: Partial<Record<Locale, string>>;
  /** Short service summary shown on the `/client` demo picker card (e.g.
   * "Haircuts, color, care, massage") — customer-facing, so it needs its
   * own per-locale copy rather than reusing `tagline` (which is only
   * shown business-side, in the workspace switcher, and isn't localized).
   * Falls back to `tagline` when unset. */
  clientDescription?: Partial<Record<Locale, string>>;
  services: ServiceDefinition[];
  staff: StaffMember[];
  resources: ResourceDefinition[];
  clients: ClientRecord[];
  appointments: Appointment[];
}
