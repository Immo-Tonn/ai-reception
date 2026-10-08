import type { NotificationPreferences } from "./types";

/**
 * Demo defaults (§ foundation, not a production preference system):
 * email on when an address exists, SMS and push off.
 */
export function defaultNotificationPreferences(contact: {
  email?: string;
}): NotificationPreferences {
  return { email: Boolean(contact.email?.trim()), sms: false, push: false };
}
