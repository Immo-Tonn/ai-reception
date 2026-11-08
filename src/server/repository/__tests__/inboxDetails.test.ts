import { describe, expect, it } from "vitest";
import { inboxDetailsFromJson } from "../inboxEventsSupabaseRepository";

describe("inboxDetailsFromJson", () => {
  it("events written before 0027 (no column / empty object) have no snapshot — nothing is invented", () => {
    expect(inboxDetailsFromJson(undefined)).toBeNull();
    expect(inboxDetailsFromJson({})).toBeNull();
    expect(inboxDetailsFromJson("x")).toBeNull();
    expect(inboxDetailsFromJson({ v: 2, client_name: "A" })).toBeNull();
  });

  it("parses a reschedule snapshot", () => {
    const d = inboxDetailsFromJson({
      v: 1, private: false, client_id: "c1", client_name: "Anna Ivanova", service: "Manicure", staff_name: "Maria",
      starts_at: "2026-10-20T08:00:00+00:00", old_starts_at: "2026-10-19T08:00:00+00:00", duration_minutes: 45,
      timezone: "Europe/Berlin", status: "confirmed", initiator: { kind: "business_user", role: "owner", name: "Maria Owner" },
    });
    expect(d).toMatchObject({ clientName: "Anna Ivanova", oldStartsAt: "2026-10-19T08:00:00+00:00", oldStatus: null, initiator: { kind: "business_user", role: "owner" } });
  });

  it("a private snapshot never exposes client / service, even if present; unknown initiator kinds are dropped", () => {
    const d = inboxDetailsFromJson({ v: 1, private: true, client_name: "Secret", service: "Secret", client_id: "c", initiator: { kind: "hacker" } });
    expect(d).toMatchObject({ isPrivate: true, clientName: null, service: null, clientId: null, initiator: null });
  });
});
