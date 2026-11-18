"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import schedulingStyles from "../scheduling.module.css";
import { PendingButton } from "./PendingButton";

/** "Cancel subscription" with an in-page confirmation, same pattern as SettingsHeader's discard confirm. */
export function CancelSubscription({ action, messages: m }: { action: () => Promise<void>; messages: Messages["billing"] }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div className={schedulingStyles.actions} style={{ marginTop: "var(--space-3)" }}>
        <Button variant="secondary" onClick={() => setConfirming(true)}>{m.cancel}</Button>
      </div>
    );
  }

  return (
    <form suppressHydrationWarning action={action} className={schedulingStyles.confirm} role="alertdialog" aria-label={m.cancelConfirmTitle} style={{ marginTop: "var(--space-4)" }}>
      <p className={schedulingStyles.confirmTitle}>{m.cancelConfirmTitle}</p>
      <p>{m.cancelConfirmText}</p>
      <div className={schedulingStyles.actions}>
        <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>{m.keep}</Button>
        <PendingButton variant="destructive" label={m.cancelConfirm} pendingLabel={m.canceling} />
      </div>
    </form>
  );
}
