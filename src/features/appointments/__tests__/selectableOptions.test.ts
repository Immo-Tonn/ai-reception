import { describe, expect, it } from "vitest";
import {
  bucketOptions,
  selectableBuckets,
  selectableVisibilities,
  visibilityOptions,
} from "../selectableOptions";

describe("selectable visibility / financial bucket options", () => {
  it("offers only Normal/Private and Main/Private in the product UI", () => {
    expect(selectableVisibilities).toEqual(["normal", "private"]);
    expect(selectableBuckets).toEqual(["main", "private"]);
  });

  it("shows a hidden legacy value when editing a record that already has it", () => {
    expect(visibilityOptions("ownerOnly")).toEqual(["normal", "private", "ownerOnly"]);
    expect(visibilityOptions("custom")).toEqual(["normal", "private", "custom"]);
    expect(bucketOptions("custom")).toEqual(["main", "private", "custom"]);
  });

  it("does not duplicate or add anything for the visible values", () => {
    expect(visibilityOptions("normal")).toEqual(["normal", "private"]);
    expect(bucketOptions("private")).toEqual(["main", "private"]);
    expect(visibilityOptions()).toEqual(["normal", "private"]);
  });

  it("keeps visibility and bucket independent: any pairing is a valid choice", () => {
    for (const v of selectableVisibilities) {
      for (const b of selectableBuckets) {
        expect(visibilityOptions(v)).toContain(v);
        expect(bucketOptions(b)).toContain(b);
      }
    }
    expect(selectableVisibilities.length * selectableBuckets.length).toBe(4);
  });
});
