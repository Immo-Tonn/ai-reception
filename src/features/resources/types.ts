import type { Locale } from "@/lib/i18n/locales";

export type ResourceType =
  | "room"
  | "vehicle"
  | "equipment"
  | "custom"
  | "station"
  | "table"
  | "lift"
  | "diagnostic"
  | "tire";

export interface ResourceDefinition {
  id: string;
  name: string;
  type: ResourceType;
  /** Per-locale display label for this workspace's own catalog — same
   * pattern as `ServiceDefinition.translations` (business/demo data,
   * deliberately off the `Messages`/i18n layer). A real workspace's own
   * custom resource names are never auto-translated; this only covers
   * the demo presets. */
  translations?: Partial<Record<Locale, string>>;
}
