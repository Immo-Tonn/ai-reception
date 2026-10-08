import type { Messages } from "@/lib/i18n";

const codeToKey = {
  forbidden: "forbidden",
  unauthenticated: "unauthenticated",
  invalid_input: "invalidInput",
  not_found: "notFound",
  conflict: "conflict",
  unknown: "generic",
} as const;

/** Stable action code -> localized text. Never raw error text. */
export function schedulingErrorText(code: string, errors: Messages["repositoryErrors"]): string {
  return errors[codeToKey[code as keyof typeof codeToKey] ?? "generic"];
}
