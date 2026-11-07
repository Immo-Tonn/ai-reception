"use client";

import { useI18n } from "@/lib/i18n/I18nProvider";

/**
 * Short warning under free-text notes: health data is a special category
 * (Art. 9 GDPR) and does not belong in business notes. Pass the same `id` to
 * the field's aria-describedby so screen readers read it with the field.
 */
export function HealthDataHint({ id }: { id: string }) {
  const { messages } = useI18n();
  return (
    <p id={id} style={{ margin: 0, fontSize: "var(--font-size-small)", color: "var(--text-secondary)" }}>
      {messages.common.healthDataWarning}
    </p>
  );
}
