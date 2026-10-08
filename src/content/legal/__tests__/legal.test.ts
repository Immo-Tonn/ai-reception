import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PublicFooterView } from "@/components/layout/PublicFooter/PublicFooterView";
import { getMessages, locales } from "@/lib/i18n";
import { allImpressumFields, impressumSections, missingImpressumFields, TODO, verifiedImpressumFacts } from "../impressum";

const SRC = path.resolve(__dirname, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

describe("PublicFooter", () => {
  const year = 2031;
  for (const locale of locales) {
    it(`renders year, legal links and Labrity link (${locale})`, () => {
      const html = renderToStaticMarkup(createElement(PublicFooterView, { locale, year }));
      const { legal } = getMessages(locale);
      expect(html).toContain("© 2031 ServiceOS");
      expect(html).not.toContain("{year}");
      expect(html).toContain('href="/impressum"');
      expect(html).toContain('href="/datenschutz"');
      expect(html).toContain('href="https://www.labrity.com/"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain(`aria-label="${legal.labrityLinkLabel}"`);
      expect(html).toContain(legal.footerRights);
      expect(html).toContain(legal.footerDevelopedBy);
      expect(html).toContain("Labrity Web Studio");
    });
  }

  it("uses the localized phrases", () => {
    const text = (l: "de" | "en" | "uk" | "ru") => renderToStaticMarkup(createElement(PublicFooterView, { locale: l, year }));
    expect(text("de")).toContain("Alle Rechte vorbehalten");
    expect(text("de")).toContain("Entwickelt von");
    expect(text("en")).toContain("All rights reserved");
    expect(text("en")).toContain("Developed by");
    expect(text("uk")).toContain("Усі права захищені");
    expect(text("uk")).toContain("Розроблено");
    expect(text("ru")).toContain("Все права защищены");
    expect(text("ru")).toContain("Разработано");
  });

  it("the wrapper computes the year at render time (no hard-coded year)", () => {
    const src = readFileSync(path.join(SRC, "components/layout/PublicFooter/PublicFooter.tsx"), "utf8");
    expect(src).toContain("new Date().getUTCFullYear()");
    expect(src).not.toMatch(/\b20\d\d\b/);
  });
});

describe("footer placement", () => {
  it("is not used by any business app page under src/app/(app)", () => {
    const offenders = walk(path.join(SRC, "app/(app)")).filter((f) => /PublicFooter|LegalPage/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("is not used by the embed pages or by BookingWizard", () => {
    const embed = walk(path.join(SRC, "app/book/[workspaceSlug]/embed"));
    for (const f of embed) expect(readFileSync(f, "utf8")).not.toContain("PublicFooter");
    expect(readFileSync(path.join(SRC, "app/book/[workspaceSlug]/BookingWizard.tsx"), "utf8")).not.toContain("PublicFooter");
  });

  it("is present on the required public surfaces", () => {
    for (const f of [
      "page.tsx",
      "business/page.tsx",
      "(auth)/login/page.tsx",
      "(auth)/signup/page.tsx",
      "client/page.tsx",
      "client/login/page.tsx",
      "client/signup/page.tsx",
      "client/book/page.tsx",
      "book/[workspaceSlug]/page.tsx",
    ]) {
      expect(readFileSync(path.join(SRC, "app", f), "utf8"), f).toContain("<PublicFooter />");
    }
  });
});

describe("legal pages", () => {
  it("exist, are public (no auth/session) and not under a gated layout", () => {
    for (const name of ["impressum", "datenschutz"]) {
      const page = path.join(SRC, "app", name, "page.tsx");
      expect(existsSync(page)).toBe(true);
      expect(existsSync(path.join(SRC, "app", name, "layout.tsx"))).toBe(false);
      const src = readFileSync(page, "utf8");
      expect(src).not.toMatch(/getSession|redirect\(|supabase/i);
      expect(src).toContain(`canonical: "/${name}"`);
      expect(src).toContain("index: true");
    }
    expect(existsSync(path.join(SRC, "app/layout.tsx"))).toBe(true);
  });

  it("proxy matcher keeps the legal pages cheap (excluded)", () => {
    const proxy = readFileSync(path.join(SRC, "proxy.ts"), "utf8");
    expect(proxy).toContain("impressum$");
    expect(proxy).toContain("datenschutz$");
  });

  it("Settings hub links to both legal pages", () => {
    const src = readFileSync(path.join(SRC, "app/(app)/[workspaceSlug]/settings/page.tsx"), "utf8");
    expect(src).toContain('"/impressum"');
    expect(src).toContain('"/datenschutz"');
  });
});

describe("Impressum data", () => {
  it("marks every undeterminable field with TODO", () => {
    expect(missingImpressumFields().length).toBeGreaterThan(0);
    expect(impressumSections.length).toBeGreaterThan(0);
  });

  it("contains no invented data: each value is TODO or a verified reference fact", () => {
    for (const f of allImpressumFields()) {
      expect(f.value === TODO || verifiedImpressumFacts.includes(f.value), f.id).toBe(true);
    }
  });

  it("holds no e-mail, phone, postcode or VAT-id shaped value in the source", () => {
    const src = readFileSync(path.join(SRC, "content/legal/impressum.ts"), "utf8");
    expect(src).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(src).not.toMatch(/\+\d{2}[\d\s]{6,}/);
    expect(src).not.toMatch(/\bDE\d{9}\b/);
    expect(src).not.toMatch(/\b\d{5}\s+[A-ZÄÖÜ]/);
  });

  it("the page renders a TODO marker via the localized label", () => {
    const page = readFileSync(path.join(SRC, "app/impressum/page.tsx"), "utf8");
    expect(page).toContain("legal.todoLabel");
    for (const l of locales) expect(getMessages(l).legal.todoLabel).toContain("TODO");
  });
});

describe("i18n legal block", () => {
  it("has the same keys in all four locales and no empty values", () => {
    const keys = (l: (typeof locales)[number]) => Object.keys(getMessages(l).legal).sort();
    for (const l of locales) {
      expect(keys(l)).toEqual(keys("en"));
      for (const v of Object.values(getMessages(l).legal)) expect(v.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps the legal nav terms in German in every locale", () => {
    for (const l of locales) {
      expect(getMessages(l).legal.impressumLabel).toBe("Impressum");
      expect(getMessages(l).legal.datenschutzLabel).toBe("Datenschutz");
    }
  });
});
