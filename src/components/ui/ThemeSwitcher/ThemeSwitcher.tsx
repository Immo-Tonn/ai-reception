"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "../Icon/Icon";
import { THEME_COOKIE, type Theme } from "@/lib/theme/theme";
import styles from "./ThemeSwitcher.module.css";

const options: { value: Theme; icon: IconName }[] = [
  { value: "light", icon: "sun" },
  { value: "dark", icon: "moon" },
  { value: "system", icon: "monitor" },
];

export function ThemeSwitcher({
  initialTheme,
  labels,
}: {
  initialTheme: Theme;
  labels: { light: string; dark: string; system: string };
}) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const router = useRouter();

  function selectTheme(value: Theme) {
    setTheme(value);
    document.cookie = `${THEME_COOKIE}=${value}; path=/; max-age=31536000; SameSite=Lax`;
    const root = document.documentElement;
    if (value === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", value);
    }
    router.refresh();
  }

  return (
    <div className={styles.group} role="radiogroup" aria-label="Theme">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={theme === option.value}
          aria-label={labels[option.value]}
          title={labels[option.value]}
          className={`${styles.option} ${theme === option.value ? styles.optionActive : ""}`}
          onClick={() => selectTheme(option.value)}
        >
          <Icon name={option.icon} size={16} />
        </button>
      ))}
    </div>
  );
}
