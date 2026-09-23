"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../Icon/Icon";
import { locales, localeMeta, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import styles from "./LanguageSwitcher.module.css";

export function LanguageSwitcher({ currentLocale }: { currentLocale: Locale }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function selectLocale(locale: Locale) {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
    setOpen(false);
    router.refresh();
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon name="globe" size={16} />
        <span className={styles.triggerLabel}>{currentLocale}</span>
        <Icon name="chevronDown" size={14} />
      </button>

      {open ? (
        <div className={styles.menu} role="listbox">
          {locales.map((locale) => (
            <button
              key={locale}
              type="button"
              role="option"
              aria-selected={locale === currentLocale}
              className={styles.option}
              onClick={() => selectLocale(locale)}
            >
              {localeMeta[locale].nativeLabel}
              {locale === currentLocale ? (
                <span className={styles.optionCheck}>
                  <Icon name="check" size={16} />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
