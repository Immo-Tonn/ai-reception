import { useId, type InputHTMLAttributes } from "react";
import styles from "./Input.module.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function Input({ label, error, id, className, ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className={[styles.input, error ? styles.error : "", className]
          .filter(Boolean)
          .join(" ")}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${inputId}-error` : undefined}
        {...props}
      />
      {error ? (
        <span id={`${inputId}-error`} className={styles.errorText}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
