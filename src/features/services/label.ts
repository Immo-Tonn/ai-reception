import type { Locale } from "@/lib/i18n/locales";
import type { ServiceDefinition } from "./types";

/** Localized display label for a service — `name` is the stable fallback
 * (and what `Appointment.service` stores as free text), `translations`
 * overrides it per locale when present. */
export function getServiceLabel(service: ServiceDefinition, locale: Locale): string {
  return service.translations?.[locale] ?? service.name;
}

/** Same lookup for the common case of only having the free-text
 * `Appointment.service` string (not a `ServiceDefinition`) — matches it
 * against the workspace's own catalog by name and localizes from there.
 * Falls back to the raw string when no service in the catalog matches
 * (e.g. an edited/legacy appointment). */
export function resolveServiceLabel(
  serviceName: string,
  services: ServiceDefinition[],
  locale: Locale,
): string {
  const match = services.find((service) => service.name === serviceName);
  return match ? getServiceLabel(match, locale) : serviceName;
}
