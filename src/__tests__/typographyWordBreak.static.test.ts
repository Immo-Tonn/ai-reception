import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Word breaking policy (src/app/globals.css): words wrap at spaces and real
 * hyphens only; no automatic hyphenation (it split "Administrator" /
 * "администратор" mid-word on phones). `overflow-wrap: anywhere` is reserved
 * for user data that can be one long token (URLs, names, descriptions, ids).
 */
const root = path.resolve(__dirname, "../..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const css = walk(path.join(root, "src")).filter((f) => f.endsWith(".css"));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

/** selector -> declarations, for the rules that use `overflow-wrap: anywhere`. */
function anywhereSelectors(file: string): string[] {
  const out: string[] = [];
  for (const m of strip(readFileSync(file, "utf8")).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/overflow-wrap:\s*anywhere/.test(m[2])) out.push(m[1].trim());
  }
  return out;
}

const ALLOWED_ANYWHERE = new Set([
  "src/app/(app)/[workspaceSlug]/settings/OnlineBooking.module.css .sectionTitle",
  "src/app/book/[workspaceSlug]/page.module.css .optionDescription",
  "src/app/book/[workspaceSlug]/page.module.css .summaryRow dd",
  "src/app/client/client.module.css .businessDescription",
  "src/app/client/client.module.css .businessName",
  "src/app/connect-calendar/connect.module.css .option",
  "src/components/legal/LegalPage/LegalPage.module.css .fieldValue",
]);

describe("typography: no mid-word breaks", () => {
  it("no automatic hyphenation and no break-all anywhere in the stylesheets", () => {
    for (const f of css) {
      const s = strip(readFileSync(f, "utf8"));
      expect(s, path.relative(root, f)).not.toMatch(/hyphens:\s*auto/);
      expect(s, path.relative(root, f)).not.toMatch(/word-break:\s*break-(all|word)/);
    }
  });

  it("overflow-wrap: anywhere only on user-data fields (one long token)", () => {
    const used = css.flatMap((f) => anywhereSelectors(f).map((sel) => `${path.relative(root, f)} ${sel}`));
    expect(used.sort()).toEqual([...ALLOWED_ANYWHERE].sort());
  });

  it("the global rule keeps break-word as the safety net and disables auto hyphenation", () => {
    const g = strip(readFileSync(path.join(root, "src/app/globals.css"), "utf8"));
    expect(g).toMatch(/body\s*\{[^}]*overflow-wrap:\s*break-word;[^}]*hyphens:\s*manual;/);
    expect(g).toMatch(/h1,\s*h2,\s*h3\s*\{\s*text-wrap:\s*balance;/);
  });
});
