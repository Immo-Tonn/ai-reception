import { describe, expect, it } from "vitest";
import { matchWaitingList } from "../matching";
import type { WaitingListEntry } from "../types";

function makeEntry(overrides: Partial<WaitingListEntry>): WaitingListEntry {
  return {
    id: "wl1",
    client: "Mia Weber",
    service: "Haircut",
    preferredStaff: null,
    earliestDate: "2026-09-01",
    latestDate: "2026-09-30",
    preferredDays: [],
    preferredTimeStart: null,
    preferredTimeEnd: null,
    ...overrides,
  };
}

describe("matchWaitingList", () => {
  it("matches an entry with no preferences to any opened slot for the same service", () => {
    const matches = matchWaitingList(
      { service: "Haircut", staff: "Elena", date: "2026-09-15", time: "14:00" },
      [makeEntry({})],
    );
    expect(matches).toHaveLength(1);
  });

  it("does not match a different service", () => {
    const matches = matchWaitingList(
      { service: "Consultation", staff: "Elena", date: "2026-09-15", time: "14:00" },
      [makeEntry({ service: "Haircut" })],
    );
    expect(matches).toHaveLength(0);
  });

  it("excludes a slot outside the entry's date range", () => {
    const matches = matchWaitingList(
      { service: "Haircut", staff: "Elena", date: "2026-10-05", time: "14:00" },
      [makeEntry({ earliestDate: "2026-09-01", latestDate: "2026-09-30" })],
    );
    expect(matches).toHaveLength(0);
  });

  it("respects a preferred-staff constraint", () => {
    const entries = [makeEntry({ preferredStaff: "Elena" })];
    expect(
      matchWaitingList({ service: "Haircut", staff: "Marco", date: "2026-09-15", time: "14:00" }, entries),
    ).toHaveLength(0);
    expect(
      matchWaitingList({ service: "Haircut", staff: "Elena", date: "2026-09-15", time: "14:00" }, entries),
    ).toHaveLength(1);
  });

  it("respects a preferred time window", () => {
    const entries = [makeEntry({ preferredTimeStart: "14:00", preferredTimeEnd: "18:00" })];
    expect(
      matchWaitingList({ service: "Haircut", staff: "Elena", date: "2026-09-15", time: "09:00" }, entries),
    ).toHaveLength(0);
    expect(
      matchWaitingList({ service: "Haircut", staff: "Elena", date: "2026-09-15", time: "15:00" }, entries),
    ).toHaveLength(1);
  });
});
