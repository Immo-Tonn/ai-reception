import { describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "../cronAuth";

describe("cron endpoint authorization", () => {
  const secret = "s3cr3t-value-0123456789";
  it("accepts exactly 'Bearer <CRON_SECRET>'", () => {
    expect(isAuthorizedCronRequest(`Bearer ${secret}`, secret)).toBe(true);
  });
  it("refuses a missing, wrong or partial header", () => {
    for (const h of [null, "", secret, `Bearer ${secret}x`, `bearer ${secret}`, "Bearer "]) expect(isAuthorizedCronRequest(h, secret)).toBe(false);
  });
  it("stays CLOSED when no (or a too short) secret is configured", () => {
    expect(isAuthorizedCronRequest("Bearer anything", undefined)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer ", "")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer short", "short")).toBe(false);
  });
});
