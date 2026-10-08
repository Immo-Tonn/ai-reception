import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { financialBucketChoices, visibilityChoices } from "../simpleOptions";

describe("simple visibility / finance choices", () => {
  it("everyday forms offer exactly two choices per axis", () => {
    expect(visibilityChoices(undefined)).toEqual(["normal", "private"]);
    expect(visibilityChoices("normal")).toEqual(["normal", "private"]);
    expect(financialBucketChoices(undefined)).toEqual(["main", "private"]);
    expect(financialBucketChoices("private")).toEqual(["main", "private"]);
  });

  it("advanced values already on a record stay visible so editing cannot lose them", () => {
    expect(visibilityChoices("ownerOnly")).toEqual(["normal", "private", "ownerOnly"]);
    expect(visibilityChoices("custom")).toEqual(["normal", "private", "custom"]);
    expect(financialBucketChoices("custom")).toEqual(["main", "private", "custom"]);
  });

  it("the appointment form uses them and keeps the two axes as separate state", () => {
    const src = readFileSync("src/components/calendar/AppointmentSheet.tsx", "utf8");
    expect(src).toContain("visibilityChoices(initialValue?.visibility)");
    expect(src).toContain("financialBucketChoices(initialValue?.financialBucket)");
    expect(src).toMatch(/useState<Visibility>/);
    expect(src).toMatch(/useState<FinancialBucket>/);
  });
});
