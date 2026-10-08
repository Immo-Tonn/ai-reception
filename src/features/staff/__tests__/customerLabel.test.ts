import { describe, expect, it } from "vitest";
import { customerStaffLabel, isPlaceholderStaffName } from "../customerLabel";

const neutral = "Specialist";

describe("customerStaffLabel", () => {
  it("keeps real names untouched", () => {
    expect(customerStaffLabel("Elena", { businessName: "Salon X", neutralLabel: neutral })).toBe("Elena");
    expect(customerStaffLabel("  Marco Rossi ", { businessName: "Salon X", neutralLabel: neutral })).toBe("Marco Rossi");
    expect(customerStaffLabel("Youssef", { businessName: "Salon X", neutralLabel: neutral })).toBe("Youssef");
  });

  it("replaces the placeholder with the business name", () => {
    for (const raw of ["You", "you", " YOU ", "\tYou\n", "Ви", "Sie", "Вы", "Du"]) {
      expect(customerStaffLabel(raw, { businessName: "Salon X", neutralLabel: neutral })).toBe("Salon X");
    }
  });

  it("falls back to the neutral label without a business name", () => {
    expect(customerStaffLabel("You", { neutralLabel: neutral })).toBe(neutral);
    expect(customerStaffLabel("You", { businessName: "   ", neutralLabel: neutral })).toBe(neutral);
    expect(customerStaffLabel("You", { businessName: null, neutralLabel: neutral })).toBe(neutral);
  });

  it("treats blank/missing names as placeholder", () => {
    expect(customerStaffLabel("", { businessName: "B", neutralLabel: neutral })).toBe("B");
    expect(customerStaffLabel(null, { neutralLabel: neutral })).toBe(neutral);
    expect(isPlaceholderStaffName("Elena")).toBe(false);
    expect(isPlaceholderStaffName(undefined)).toBe(true);
  });
});
