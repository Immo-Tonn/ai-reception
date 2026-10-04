import { describe, expect, it } from "vitest";
import { resolveToday } from "../zonedTime";

// Work (lead/quote/job/project/invoice) default `createdAt`/`date` = resolveToday(now, workspaceZone).
describe("work default date via resolveToday", () => {
  it("Berlin day boundary", () => {
    expect(resolveToday(new Date("2026-10-03T22:30:00Z"), "Europe/Berlin")).toBe("2026-10-04");
    expect(resolveToday(new Date("2026-10-03T21:30:00Z"), "Europe/Berlin")).toBe("2026-10-03");
  });
  it("DST end and start", () => {
    expect(resolveToday(new Date("2026-10-25T23:30:00Z"), "Europe/Berlin")).toBe("2026-10-26");
    expect(resolveToday(new Date("2026-03-28T23:30:00Z"), "Europe/Berlin")).toBe("2026-03-29");
  });
  it("other zone differs", () => {
    expect(resolveToday(new Date("2026-10-03T22:30:00Z"), "America/New_York")).toBe("2026-10-03");
  });
  it("demo (null zone) uses the browser-local date", () => {
    const now = new Date("2026-10-03T22:30:00Z");
    const p = (n: number) => String(n).padStart(2, "0");
    expect(resolveToday(now, null)).toBe(`${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`);
  });
});
