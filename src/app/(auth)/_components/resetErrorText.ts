import type { Messages } from "@/lib/i18n";
import type { ResetError } from "@/server/actions/passwordReset.actions";

/** Localized text for a password-reset error code (the action returns codes, never raw messages). */
export function resetErrorText(
  error: ResetError,
  messages: Messages["passwordReset"],
  errors: Messages["authErrors"],
): string {
  switch (error) {
    case "invalid_code":
      return messages.invalidCode;
    case "same_password":
      return messages.samePassword;
    case "password_mismatch":
      return messages.passwordMismatch;
    default:
      return errors[error];
  }
}
