import { describe, expect, it } from "vitest";
import { INBOX_AUTO_DELETE_ENABLED, inboxRetentionCutoff, resolveInboxRetentionMonths } from "../inboxRetention";

describe("inbox retention setting", () => {
  it("defaults to 12 months; accepts whole months 1..120 only", () => {
    expect(resolveInboxRetentionMonths(undefined)).toBe(12);
    expect(resolveInboxRetentionMonths("24")).toBe(24);
    expect(resolveInboxRetentionMonths("0")).toBe(12);
    expect(resolveInboxRetentionMonths("6.5")).toBe(12);
    expect(resolveInboxRetentionMonths("abc")).toBe(12);
    expect(resolveInboxRetentionMonths("121")).toBe(12);
  });

  it("automatic deletion stays off until separately approved", () => {
    expect(INBOX_AUTO_DELETE_ENABLED).toBe(false);
  });

  it("cutoff is N calendar months back", () => {
    expect(inboxRetentionCutoff(12, new Date("2026-10-15T00:00:00Z")).toISOString()).toBe("2025-10-15T00:00:00.000Z");
  });
});
