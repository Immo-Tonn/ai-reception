import type { NotificationChannel, NotificationSendResult, RenderedNotification } from "./types";

/**
 * The only thing the application layer knows about delivering a message.
 * A real vendor (an email API, an SMS gateway, a push service) becomes
 * one more adapter implementing this interface — BookingService /
 * NotificationService never import a vendor SDK, so swapping or adding
 * a provider touches one file.
 */
export interface NotificationProvider {
  readonly channel: NotificationChannel;
  send(message: RenderedNotification): Promise<NotificationSendResult>;
}
