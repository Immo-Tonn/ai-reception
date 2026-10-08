import { reportError } from "@/lib/errorReporter";
import type { NotificationProvider } from "./NotificationProvider";
import { createConsoleNotificationProvider } from "./providers/ConsoleNotificationProvider";
import { defaultNotificationPreferences } from "./preferences";
import { renderEmail } from "./templates/email";
import { renderSms } from "./templates/sms";
import type {
  NotificationChannel,
  NotificationEvent,
  NotificationPreferences,
  NotificationSendResult,
  RenderedNotification,
} from "./types";

export interface NotificationDispatchResult {
  results: NotificationSendResult[];
  /** Channels not attempted (preference off, no recipient, or no adapter). */
  skipped: NotificationChannel[];
}

export interface NotificationService {
  /**
   * Fan an event out to the enabled channels. NEVER throws: a delivery
   * problem is reported (`reporter`) and returned as `ok: false` — it
   * must not be able to undo or fail the booking that triggered it.
   */
  notify(
    event: NotificationEvent,
    preferences?: NotificationPreferences,
  ): Promise<NotificationDispatchResult>;
}

interface Dependencies {
  providers: NotificationProvider[];
  reporter?: (context: string, error: unknown) => void;
}

export function createNotificationService({
  providers,
  reporter = reportError,
}: Dependencies): NotificationService {
  const byChannel = new Map<NotificationChannel, NotificationProvider>(
    providers.map((provider) => [provider.channel, provider]),
  );

  function render(channel: NotificationChannel, event: NotificationEvent): RenderedNotification | null {
    const { clientEmail, clientPhone } = event.payload;
    if (channel === "EMAIL") {
      if (!clientEmail?.trim()) return null;
      const email = renderEmail(event);
      return { channel, event, to: clientEmail, subject: email.subject, text: email.text, html: email.html };
    }
    if (channel === "SMS") {
      if (!clientPhone?.trim()) return null;
      return { channel, event, to: clientPhone, text: renderSms(event) };
    }
    // PUSH / IN_APP: channels are reserved by the architecture; no
    // recipient model (device token / user id) or adapter exists yet.
    return null;
  }

  return {
    async notify(event, preferences = defaultNotificationPreferences({ email: event.payload.clientEmail })) {
      const wanted: [NotificationChannel, boolean][] = [
        ["EMAIL", preferences.email],
        ["SMS", preferences.sms],
        ["PUSH", preferences.push],
      ];

      const results: NotificationSendResult[] = [];
      const skipped: NotificationChannel[] = [];

      for (const [channel, enabled] of wanted) {
        const provider = byChannel.get(channel);
        const message = enabled && provider ? render(channel, event) : null;
        if (!provider || !message) {
          skipped.push(channel);
          continue;
        }
        try {
          results.push(await provider.send(message));
        } catch (error) {
          reporter(`notification ${event.type} via ${channel} failed`, error);
          results.push({
            channel,
            ok: false,
            delivered: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      for (const result of results) {
        if (!result.ok) reporter(`notification ${event.type} via ${result.channel} failed`, result.error);
      }
      return { results, skipped };
    },
  };
}

/**
 * The app-wide instance. Today ONLY the Console/Mock adapter is wired —
 * no real email/SMS/push vendor is connected. A real adapter is added by
 * registering it here (or from config); nothing upstream changes.
 */
export const notificationService: NotificationService = createNotificationService({
  providers: [createConsoleNotificationProvider("EMAIL"), createConsoleNotificationProvider("SMS")],
});
