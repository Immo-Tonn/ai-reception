import { describe, expect, it } from "vitest";
import {
  buildGoogleContext,
  encodeGoogleContext,
  googleErrorFromParam,
  googleFailureHref,
  googleLandingPath,
  isGoogleLoginEnabled,
  parseGoogleContext,
} from "../googleLogin";

describe("Google sign-in switch", () => {
  it("is on only for the exact value 'true'", () => {
    expect(isGoogleLoginEnabled({ GOOGLE_LOGIN_ENABLED: "true" })).toBe(true);
    for (const v of [undefined, "", "TRUE", "True", "1", "yes", " true", "true ", "on"]) {
      expect(isGoogleLoginEnabled({ GOOGLE_LOGIN_ENABLED: v })).toBe(false);
    }
  });
});

describe("Google context cookie", () => {
  it("round-trips owner and client contexts", () => {
    expect(parseGoogleContext(encodeGoogleContext(buildGoogleContext("owner", "")))).toEqual({ intent: "owner", next: "" });
    const client = buildGoogleContext("client", "/client/bookings?x=1");
    expect(parseGoogleContext(encodeGoogleContext(client))).toEqual({ intent: "client", next: "/client/bookings?x=1" });
  });

  it("never lets an owner context carry a return path", () => {
    expect(buildGoogleContext("owner", "/client/bookings")).toEqual({ intent: "owner", next: "" });
  });

  it("falls back to the default client path for anything outside /client", () => {
    for (const next of ["https://evil.example/x", "//evil.example", "/admin", "/client/../admin", "/client//x", "/client%2f..%2fx", "javascript:alert(1)", "/client\\x"]) {
      expect(buildGoogleContext("client", next).next).toBe("/client/bookings");
      expect(parseGoogleContext(`client|${encodeURIComponent(next)}`)?.next).toBe("/client/bookings");
    }
  });

  it("rejects malformed cookie values", () => {
    for (const raw of [undefined, null, "", "owner", "admin|x", "client|%E0%A4%A", "x".repeat(401), "|"]) {
      expect(parseGoogleContext(raw as string | undefined)).toBeNull();
    }
  });
});

describe("where the person goes next", () => {
  it("failure goes back to the page the person came from, with a stable code", () => {
    expect(googleFailureHref("owner", "google_failed")).toBe("/login?google=google_failed");
    expect(googleFailureHref("client", "google_cancelled", "/client/book")).toBe("/client/login?redirect=%2Fclient%2Fbook&google=google_cancelled");
    expect(googleFailureHref("client", "google_failed", "https://evil.example")).toContain("redirect=%2Fclient%2Fbookings");
  });

  it("owner with a workspace -> today, without -> finish sign-up; client -> own safe path", () => {
    expect(googleLandingPath({ intent: "owner", next: "" }, "salon-anna")).toBe("/salon-anna/today");
    expect(googleLandingPath({ intent: "owner", next: "" }, null)).toBe("/signup/google");
    expect(googleLandingPath({ intent: "client", next: "/client/profile" }, "ignored")).toBe("/client/profile");
    expect(googleLandingPath({ intent: "client", next: "https://evil.example" }, null)).toBe("/client/bookings");
  });

  it("only known error codes are shown", () => {
    expect(googleErrorFromParam("google_failed")).toBe("google_failed");
    expect(googleErrorFromParam(["google_cancelled", "x"])).toBe("google_cancelled");
    for (const v of ["<script>", "unknown", "", undefined, 5, "invalid_credentials"]) expect(googleErrorFromParam(v)).toBeNull();
  });
});
