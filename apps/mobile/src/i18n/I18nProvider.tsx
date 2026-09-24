import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import * as Localization from "expo-localization";
import { defaultLocale, locales, messages, type Locale, type Messages } from "./messages";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Messages;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function detectDeviceLocale(): Locale {
  const tag = Localization.getLocales()[0]?.languageCode ?? "en";
  return (locales as string[]).includes(tag) ? (tag as Locale) : defaultLocale;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(detectDeviceLocale);
  const value = useMemo(() => ({ locale, setLocale, t: messages[locale] }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
