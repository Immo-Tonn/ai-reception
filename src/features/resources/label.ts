import type { Locale } from "@/lib/i18n/locales";
import type { ResourceDefinition } from "./types";

/** Localized display label for a resource — `name` is the stable
 * fallback, `translations` overrides it per locale when present. */
export function getResourceLabel(resource: ResourceDefinition, locale: Locale): string {
  return resource.translations?.[locale] ?? resource.name;
}
