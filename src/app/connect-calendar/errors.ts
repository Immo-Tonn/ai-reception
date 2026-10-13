import type { Messages } from "@/lib/i18n";
import type { ConnectPageError } from "@/server/externalCalendar/http";

/** Stable error code -> localized sentence for the connect pages. */
export function connectErrorText(code: ConnectPageError, m: Messages["connectCalendar"]): string {
  switch (code) {
    case "denied":
      return m.errDenied;
    case "insufficient_scope":
      return m.errInsufficientScope;
    case "state_mismatch":
      return m.errStateMismatch;
    case "provider_error":
      return m.errProvider;
    case "expired_link":
    case "invalid_link":
      return m.errExpiredLink;
    case "not_configured":
      return m.notConfigured;
    case "rate_limited":
      return m.errRateLimited;
    default:
      return m.errGeneric;
  }
}
