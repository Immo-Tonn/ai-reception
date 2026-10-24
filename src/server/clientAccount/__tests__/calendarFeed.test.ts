import { describe, expect, it } from "vitest";
import { bookingsToIcs, createFeedToken, readFeedToken } from "../calendarFeed";
import type { MyBooking } from "@/features/clientAccount/types";

const SECRET = "test-secret";
const USER = "11111111-2222-4333-8444-555555555555";

describe("client calendar feed token", () => {
  it("round-trips and rejects tampering", () => {
    const token = createFeedToken(SECRET, USER, 3);
    expect(readFeedToken(SECRET, token)).toEqual({ userId: USER, version: 3 });
    expect(readFeedToken("other-secret", token)).toBeNull();
    expect(readFeedToken(SECRET, token.replace(".3.", ".4."))).toBeNull(); // version is signed
    const other = "99999999-2222-4333-8444-555555555555";
    expect(readFeedToken(SECRET, token.replace(USER, other))).toBeNull(); // user is signed
    expect(readFeedToken(SECRET, "v1.not-a-uuid.0.x")).toBeNull();
    expect(readFeedToken(SECRET, "garbage")).toBeNull();
  });
});

const booking = (over: Partial<MyBooking>): MyBooking => ({
  id: "a1", workspaceSlug: "salon", businessName: "Beauty Salon", timezone: "Europe/Berlin",
  startsAt: "2026-10-26T09:00:00Z", endsAt: "2026-10-26T09:45:00Z", date: "2026-10-26", time: "10:00", endTime: "10:45",
  status: "confirmed", serviceId: "s", serviceName: "Haircut", staffId: "st", staffName: "Elena", resourceId: null,
  price: 55, currency: "EUR", isUpcoming: true, canCancel: true, canReschedule: true, ...over,
});

describe("bookings -> iCalendar", () => {
  it("includes upcoming and recent bookings, marks cancellations, leaves out old ones and prices", () => {
    const ics = bookingsToIcs(
      [
        booking({}),
        booking({ id: "a2", status: "cancelled" }),
        booking({ id: "old", startsAt: "2026-01-01T09:00:00Z", endsAt: "2026-01-01T09:30:00Z" }),
      ],
      { calendarName: "My bookings", manageUrl: "https://livetermin.de/client/bookings", now: new Date("2026-10-24T08:00:00Z") },
    );
    expect(ics).toContain("UID:appointment-a1@serviceos");
    expect(ics).toContain("SUMMARY:Haircut · Beauty Salon");
    expect(ics).toMatch(/UID:appointment-a2@serviceos[\s\S]*?STATUS:CANCELLED/);
    expect(ics).not.toContain("appointment-old@");
    expect(ics).not.toMatch(/55|EUR/);
  });
});
