"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui";

/** Submit button that blocks a double tap and shows progress while Stripe answers. */
export function PendingButton({ label, pendingLabel, disabled, ...props }: ButtonProps & { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending} {...props}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
