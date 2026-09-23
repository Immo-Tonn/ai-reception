import { describe, expect, it } from "vitest";
import { applyVisibility, canSeeVisibility } from "../masking";
import type { Appointment, FinancialBucket, Visibility } from "@/features/appointments/types";
import type { Session } from "@/server/auth/session";
import type { Role } from "@/server/permissions/roles";

function makeAppointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: "a1",
    client: "Anna Müller",
    service: "Consultation",
    staff: "Elena",
    resourceId: null,
    date: "2026-09-22",
    time: "14:00",
    durationMinutes: 60,
    price: 150,
    currency: "EUR",
    notes: "Sensitive detail that must never leak",
    visibility: "normal",
    financialBucket: "main",
    status: "confirmed",
    paid: true,
    seriesId: null,
    recurrence: null,
    ...overrides,
  };
}

function sessionAs(role: Role): Session {
  return { userId: "u1", workspaceId: "w1", role };
}

/**
 * §8/§97 non-negotiable requirement #5/#6, and the explicit test this
 * task calls out by name: a caller without `private_records.view` must
 * never receive client name, service, price or notes for a private
 * appointment — masking is applied server-side, not left to the UI.
 */
describe("applyVisibility — private masking", () => {
  it("shows full details for a NORMAL appointment to any role", () => {
    const appt = makeAppointment({ visibility: "normal" });
    for (const role of ["owner", "admin", "manager", "staff", "accountant"] as Role[]) {
      const result = applyVisibility(appt, sessionAs(role));
      expect(result.masked).toBe(false);
    }
  });

  it("masks a PRIVATE appointment for a role without private_records.view", () => {
    const appt = makeAppointment({ visibility: "private" });
    const result = applyVisibility(appt, sessionAs("staff"));

    expect(result.masked).toBe(true);
    // The masked shape must not even carry these keys, not just hide
    // them in the UI — check the object itself has no client/price/notes.
    expect("client" in result).toBe(false);
    expect("service" in result).toBe(false);
    expect("price" in result).toBe(false);
    expect("notes" in result).toBe(false);
  });

  it("still exposes only time/duration/status when masked", () => {
    const appt = makeAppointment({ visibility: "private", time: "14:00", durationMinutes: 60 });
    const result = applyVisibility(appt, sessionAs("staff"));
    expect(result.masked).toBe(true);
    if (result.masked) {
      expect(result.time).toBe("14:00");
      expect(result.durationMinutes).toBe(60);
    }
  });

  it("reveals a PRIVATE appointment to a role that has private_records.view (owner)", () => {
    const appt = makeAppointment({ visibility: "private" });
    const result = applyVisibility(appt, sessionAs("owner"));
    expect(result.masked).toBe(false);
    if (!result.masked) {
      expect(result.client).toBe("Anna Müller");
      expect(result.notes).toContain("Sensitive");
    }
  });

  it("masks an OWNER_ONLY appointment for every non-owner role, including admin", () => {
    const appt = makeAppointment({ visibility: "ownerOnly" });
    for (const role of ["admin", "manager", "staff", "accountant"] as Role[]) {
      const result = applyVisibility(appt, sessionAs(role));
      expect(result.masked).toBe(true);
    }
  });

  it("reveals an OWNER_ONLY appointment only to the owner", () => {
    const appt = makeAppointment({ visibility: "ownerOnly" });
    expect(applyVisibility(appt, sessionAs("owner")).masked).toBe(false);
  });

  it("treats CUSTOM visibility as masked by default without private_records.view", () => {
    const appt = makeAppointment({ visibility: "custom" });
    expect(applyVisibility(appt, sessionAs("staff")).masked).toBe(true);
  });

  it("never leaks the client name inside the masked object's own values", () => {
    const appt = makeAppointment({ visibility: "private", client: "Very Secret Client" });
    const result = applyVisibility(appt, sessionAs("staff"));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Very Secret Client");
    expect(serialized).not.toContain("Sensitive detail");
  });
});

/**
 * §7.1/§97 non-negotiable requirement: Visibility and FinancialBucket are
 * two independent axes, never merged into one flag. `canSeeVisibility` is
 * the shared function reused by both Appointment masking (above) and
 * Invoice masking (finance.service.ts) — this proves its verdict depends
 * only on `visibility` and never on whatever bucket accompanies it, so an
 * invoice can freely be e.g. PRIVATE+MAIN or NORMAL+PRIVATE without the
 * two checks interfering.
 */
describe("canSeeVisibility — independent of FinancialBucket", () => {
  interface FakeInvoiceLike {
    visibility: Visibility;
    bucket: FinancialBucket;
  }

  function makeInvoiceLike(visibility: Visibility, bucket: FinancialBucket): FakeInvoiceLike {
    return { visibility, bucket };
  }

  it("gives the same verdict for a given visibility regardless of bucket", () => {
    const buckets: FinancialBucket[] = ["main", "private", "custom"];
    for (const bucket of buckets) {
      const invoice = makeInvoiceLike("private", bucket);
      // Bucket never enters this call — proves the function cannot read it.
      expect(canSeeVisibility(invoice.visibility, sessionAs("staff"))).toBe(false);
      expect(canSeeVisibility(invoice.visibility, sessionAs("owner"))).toBe(true);
    }
  });

  it("lets a NORMAL-visibility invoice through for any role even when its bucket is private", () => {
    const invoice = makeInvoiceLike("normal", "private");
    for (const role of ["owner", "admin", "manager", "staff", "accountant"] as Role[]) {
      expect(canSeeVisibility(invoice.visibility, sessionAs(role))).toBe(true);
    }
  });

  it("still hides a PRIVATE-visibility invoice from staff even when its bucket is main", () => {
    const invoice = makeInvoiceLike("private", "main");
    expect(canSeeVisibility(invoice.visibility, sessionAs("staff"))).toBe(false);
  });

  it("mixes freely: OWNER_ONLY+main and NORMAL+private are each governed only by their own axis", () => {
    const ownerOnlyMain = makeInvoiceLike("ownerOnly", "main");
    const normalPrivate = makeInvoiceLike("normal", "private");

    expect(canSeeVisibility(ownerOnlyMain.visibility, sessionAs("admin"))).toBe(false);
    expect(canSeeVisibility(normalPrivate.visibility, sessionAs("admin"))).toBe(true);
  });
});
