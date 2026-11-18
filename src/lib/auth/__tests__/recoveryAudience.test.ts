import { describe, expect, it } from "vitest";
import { parseRecoveryAudience, recoveryLoginPath, withAudience } from "../recoveryAudience";

describe("recovery audience", () => {
  it("only the exact word 'client' selects the client audience", () => {
    expect(parseRecoveryAudience("client")).toBe("client");
    for (const v of ["business", "", "CLIENT", "//evil.example", "https://evil.example", undefined, null, 1, ["client"]]) {
      expect(parseRecoveryAudience(v)).toBe("business");
    }
  });

  it("picks one of two fixed sign-in paths, never a free-form one", () => {
    expect(recoveryLoginPath("business")).toBe("/login");
    expect(recoveryLoginPath("client")).toBe("/client/login");
  });

  it("business URLs are unchanged; the client audience adds for=client", () => {
    expect(withAudience("/forgot-password", "business")).toBe("/forgot-password");
    expect(withAudience("/reset-password", "business", { email: "a@x.test" })).toBe("/reset-password?email=a%40x.test");
    expect(withAudience("/forgot-password", "client")).toBe("/forgot-password?for=client");
    expect(withAudience("/reset-password", "client", { email: "a@x.test" })).toBe("/reset-password?email=a%40x.test&for=client");
    expect(withAudience("/forgot-password", "client", { expired: "1" })).toBe("/forgot-password?expired=1&for=client");
  });
});
