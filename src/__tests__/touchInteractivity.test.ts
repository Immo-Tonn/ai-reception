import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isDevHostBlocked, hostnameOf } from "@/lib/config/appEnv";

const repo = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(repo, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const full = path.join(dir, f);
    if (f === "__tests__") continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("dev host blocking (LAN phone gets a page that never hydrates)", () => {
  it("localhost is never blocked, an unlisted LAN IP is, a listed one is not", () => {
    expect(isDevHostBlocked("localhost:3000", [])).toBe(false);
    expect(isDevHostBlocked("app.localhost:3000", [])).toBe(false);
    expect(isDevHostBlocked("192.168.0.179:3000", [])).toBe(true);
    expect(isDevHostBlocked("192.168.0.179:3000", ["192.168.0.179"])).toBe(false);
    expect(isDevHostBlocked("192.168.0.180:3000", ["192.168.0.179"])).toBe(true);
    expect(isDevHostBlocked("mac.local:3000", ["*.local"])).toBe(false);
    expect(isDevHostBlocked(null, [])).toBe(false);
    expect(hostnameOf("[::1]:3000")).toBe("[::1]");
  });

  it("root layout renders the server-side warning; it is dev-only and never blocks taps", () => {
    expect(read("src/app/layout.tsx")).toContain("<DevHostWarning />");
    const c = read("src/components/layout/DevHostWarning/DevHostWarning.tsx");
    expect(c).toMatch(/NODE_ENV !== "development"\) return null/);
    expect(c).not.toMatch(/use client/);
    expect(read("src/components/layout/DevHostWarning/DevHostWarning.module.css")).toMatch(/pointer-events:\s*none/);
  });

  it("no LAN IP is hard-coded in next.config.ts and the env var is documented", () => {
    expect(read("next.config.ts")).not.toMatch(/\b(192\.168|10\.\d+|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+/);
    const doc = read("docs/STAGING.md");
    expect(doc).toContain("ALLOWED_DEV_ORIGINS");
    expect(doc).toContain("Mandatory real-device touch check");
  });
});

describe("service worker cannot serve stale or mismatched JS", () => {
  const sw = read("public/sw.js");
  const reg = read("src/components/layout/ServiceWorkerRegistration.tsx");

  it("never caches navigations/HTML and ignores non-GET", () => {
    expect(sw).toMatch(/request\.mode === "navigate"[\s\S]{0,200}fetch\(request\)/);
    expect(sw).toMatch(/request\.method !== "GET"\) return/);
    expect(sw).not.toMatch(/cache\.put\(request[^)]*\)[\s\S]{0,40}navigate/);
  });

  it("versions its cache, purges old namespaces and is inert on dev/LAN hosts", () => {
    expect(sw).toMatch(/const VERSION = "serviceos-sw-v\d+"/);
    expect(sw).toMatch(/key !== STATIC_CACHE/);
    expect(sw).toMatch(/if \(DEV_HOST\) return;/);
    expect(sw).toContain("registration.unregister()");
  });

  it("only registers in production and unregisters + clears caches in dev", () => {
    expect(reg).toMatch(/NODE_ENV !== "production"[\s\S]*getRegistrations[\s\S]*caches\.delete[\s\S]*return;/);
    expect(reg.indexOf('register("/sw.js")')).toBeGreaterThan(reg.indexOf("getRegistrations"));
  });
});

describe("no leftover scroll locks / overlays", () => {
  it("Sheet renders nothing when closed, uses no body lock, and is portal-unmounted", () => {
    const sheet = read("src/components/ui/Sheet/Sheet.tsx");
    expect(sheet).toMatch(/if \(!open \|\| !mounted\) return null/);
    expect(sheet).not.toMatch(/body\.style|classList|overflow/);
  });

  it("no source file locks body/html scrolling", () => {
    const offenders = walk(path.join(repo, "src")).filter((f) => {
      if (!/\.(tsx?|css)$/.test(f)) return false;
      const t = readFileSync(f, "utf8");
      return /(document\.body|documentElement)\.style|body\s*\{[^}]*overflow:\s*hidden|html\s*\{[^}]*overflow:\s*hidden/.test(t);
    });
    expect(offenders).toEqual([]);
  });

  it("full-viewport fixed overlays are only the Sheet (modal, unmounted when closed)", () => {
    const offenders = walk(path.join(repo, "src"))
      .filter((f) => f.endsWith(".css"))
      .filter((f) => /position:\s*fixed;[^}]*inset:\s*0/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(repo, f));
    expect(offenders).toEqual(["src/components/ui/Sheet/Sheet.module.css"]);
  });

  it("decorative fixed layers (badge, dev banner) ignore pointer events", () => {
    for (const f of [
      "src/components/layout/EnvironmentBadge/EnvironmentBadge.module.css",
      "src/components/layout/DevHostWarning/DevHostWarning.module.css",
    ]) {
      expect(read(f)).toMatch(/pointer-events:\s*none/);
    }
  });
});
