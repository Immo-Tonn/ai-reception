import type { Appointment } from "@/features/appointments/types";
import type { ClientRecord } from "@/features/clients/types";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import type { ResourceDefinition } from "@/features/resources/types";

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
  services: ServiceDefinition[];
  staff: StaffMember[];
  resources: ResourceDefinition[];
  clients: ClientRecord[];
  appointments: Appointment[];
}
