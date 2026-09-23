import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { getRequestLocale } from "@/lib/i18n/next";
import { localeMeta } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { getRequestTheme } from "@/lib/theme/next";
import { ServiceWorkerRegistration } from "@/components/layout/ServiceWorkerRegistration";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ServiceOS",
  description:
    "AI-powered business assistant for service businesses — scheduling, clients, jobs, finance and communication in one calm workspace.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ServiceOS",
  },
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the app draw under the iOS notch/home-indicator so our own
  // env(safe-area-inset-*) padding (already used throughout the app
  // shell) can reserve the right space in standalone mode (§4).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#12141c" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getRequestLocale();
  const { dir } = localeMeta[locale];
  const theme = await getRequestTheme();
  // "system" stays unset so the CSS `prefers-color-scheme` branch decides —
  // only an explicit light/dark choice is forced via the attribute, so
  // there is no client-side theme flip and therefore no flash.
  const dataTheme = theme === "system" ? undefined : theme;

  return (
    <html lang={locale} dir={dir} data-theme={dataTheme} className={inter.variable}>
      <body>
        <I18nProvider locale={locale}>{children}</I18nProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
