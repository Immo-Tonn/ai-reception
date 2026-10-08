import { RemoteRepositoryError } from "./createRemoteRepository";
import type { Messages } from "@/lib/i18n";

/**
 * Turns a failed save into text the person can act on, instead of letting an unhandled
 * rejection reach the framework's red error overlay. Only a stable error CODE ever
 * arrives here (never database text).
 *
 * `duplicateClient`: a "conflict" while creating a client means that e-mail is already taken.
 */
export function describeSaveError(
  error: unknown,
  messages: Messages["repositoryErrors"],
  options: { duplicateClient?: boolean } = {},
): string {
  const code = error instanceof RemoteRepositoryError ? error.code : "unknown";
  switch (code) {
    case "conflict":
      return options.duplicateClient ? messages.clientExists : messages.conflict;
    case "invalid_input":
      return messages.invalidInput;
    case "forbidden":
      return messages.forbidden;
    case "unauthenticated":
      return messages.unauthenticated;
    case "not_found":
      return messages.notFound;
    default:
      return messages.generic;
  }
}
