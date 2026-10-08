import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Google Chrome for iOS adds `__gcruniqueid` to <form>/<input>/<textarea>/<select> (and
 * `__gcrremoteframetoken` to <html>) BEFORE React hydrates, which raises a red Next.js
 * hydration overlay in development. `suppressHydrationWarning` is attribute-only and
 * element-scoped (children/text mismatches still warn), so every form control must carry
 * it — this test keeps a newly added control from reintroducing the overlay.
 */
const root = path.resolve(__dirname, "..");
function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "__tests__") walk(full, out);
    } else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("browser-injected attributes (Chrome for iOS)", () => {
  it("every <form>, <input>, <textarea> and <select> opts out of attribute hydration warnings", () => {
    const missing: string[] = [];
    for (const file of walk(root)) {
      const text = readFileSync(file, "utf8");
      const opening = /<(form|input|textarea|select)(?=[\s>/])/g;
      let m: RegExpExecArray | null;
      while ((m = opening.exec(text)) !== null) {
        // The opening tag ends at the first '>' that is not inside a {...} expression.
        let depth = 0;
        let end = m.index;
        for (; end < text.length; end++) {
          const ch = text[end];
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
          else if (ch === ">" && depth === 0) break;
        }
        if (!text.slice(m.index, end).includes("suppressHydrationWarning")) {
          missing.push(`${path.relative(root, file)}: <${m[1]}>`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("<html> carries it too (browser-added __gcrremoteframetoken)", () => {
    expect(readFileSync(path.join(root, "app/layout.tsx"), "utf8")).toMatch(/<html[^>]*suppressHydrationWarning/);
  });
});
