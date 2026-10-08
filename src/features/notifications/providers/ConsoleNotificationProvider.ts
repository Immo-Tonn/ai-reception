import type { NotificationProvider } from "../NotificationProvider";
import type { NotificationChannel, NotificationSendResult, RenderedNotification } from "../types";

/**
 * Mock adapter: logs what WOULD be sent and returns `delivered: false`.
 * It exists so the whole booking → notification flow can be exercised
 * with no external API, credentials or cost. Never claims delivery.
 */
export function createConsoleNotificationProvider(
  channel: NotificationChannel,
  log: (message: string, detail: unknown) => void = defaultLog,
): NotificationProvider {
  return {
    channel,
    async send(message: RenderedNotification): Promise<NotificationSendResult> {
      log(`[notifications:${channel}] ${message.event.type} (mock — not sent)`, {
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      return { channel, ok: true, delivered: false };
    },
  };
}

function defaultLog(message: string, detail: unknown) {
  // eslint-disable-next-line no-console
  console.info(message, detail);
}
