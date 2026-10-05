import { headers } from "next/headers";
import { hostnameOf, isDevHostBlocked, parseAllowedDevOrigins } from "@/lib/config/appEnv";
import styles from "./DevHostWarning.module.css";

/**
 * DEV SERVER ONLY (renders nothing in production builds / on Vercel).
 *
 * If the page was opened through a host that `next dev` blocks (a LAN IP not
 * listed in ALLOWED_DEV_ORIGINS), the browser gets SSR HTML that never
 * hydrates: scrolling works, taps do nothing. A client component can't warn
 * about that (it never runs), so this is plain server-rendered markup.
 */
export async function DevHostWarning() {
  if (process.env.NODE_ENV !== "development") return null;
  const host = (await headers()).get("host");
  if (!isDevHostBlocked(host, parseAllowedDevOrigins(process.env.ALLOWED_DEV_ORIGINS))) return null;
  const name = hostnameOf(host);
  return (
    <div className={styles.banner} role="alert" data-dev-host-warning="">
      DEV: {name} is not in ALLOWED_DEV_ORIGINS, so this page will NOT respond to taps. Add
      ALLOWED_DEV_ORIGINS={name} to .env.local, restart `next dev`, hard reload. See docs/STAGING.md.
    </div>
  );
}
