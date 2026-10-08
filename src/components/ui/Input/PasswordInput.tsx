"use client";

import { forwardRef, useId, useState, type InputHTMLAttributes } from "react";
import { Icon } from "../Icon/Icon";
import styles from "./Input.module.css";

export interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  error?: string;
  /** Localized accessible names for the toggle ("Show password" / "Hide password"). */
  showLabel: string;
  hideLabel: string;
}

/**
 * Password field with a show/hide button INSIDE the field. Toggling only flips
 * `type` between "password" and "text" on the same, uncontrolled input — the
 * typed value, browser autofill and `autocomplete` are untouched. The button
 * has a 44px touch target, is keyboard-focusable and announces its state.
 * It never takes focus away from the field on press (so the keyboard stays up
 * on iOS) and is excluded from form submission (`type="button"`).
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { label, error, id, className, showLabel, hideLabel, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <div className={styles.passwordWrap}>
        <input
          ref={ref}
          id={inputId}
          type={visible ? "text" : "password"}
          className={[styles.input, styles.passwordInput, error ? styles.error : "", className].filter(Boolean).join(" ")}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          // Chrome for iOS tags inputs with `__gcruniqueid` before hydration (attribute-only, this element only).
          suppressHydrationWarning
          {...props}
        />
        <button
          type="button"
          className={styles.passwordToggle}
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          title={visible ? hideLabel : showLabel}
          // Keep focus (and the on-screen keyboard) in the input while toggling.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVisible((value) => !value)}
        >
          <Icon name={visible ? "eyeOff" : "eye"} size={20} aria-hidden="true" />
        </button>
      </div>
      {error ? (
        <span id={`${inputId}-error`} className={styles.errorText} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
});
