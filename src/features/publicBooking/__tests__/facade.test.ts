import { describe, expect, it, vi } from "vitest";

let slotsResult: unknown = { ok: true, data: [{ time: "09:00", staffId: "s", staffName: "You", resourceId: null }] };
let bookResult: unknown = { ok: false, code: "slot_unavailable" };
vi.mock("@/server/actions/publicBooking.actions", () => ({
  getPublicSlotsAction: async () => slotsResult,
  createPublicBookingAction: async () => bookResult,
}));

const { getPublicBookingService, BookingUnavailableError, BookingRateLimitedError } = await import("../bookingService");
const { localDemoBookingService } = await import("../localDemoBookingService");
const { remotePublicBookingService } = await import("../remotePublicBookingService");

const request = { serviceId: "s", staffId: null, date: "2026-10-05", time: "09:00", client: { name: "A", email: "a@b.co", phone: "+49 1", notes: "" } };

describe("which backend a booking page talks to", () => {
  it("demo workspaces use the browser adapter (no backend needed); every other slug uses the shared backend", () => {
    for (const slug of ["demo-salon", "demo-werkstatt", "demo-cleaning", "demo-consulting"]) {
      expect(getPublicBookingService(slug)).toBe(localDemoBookingService);
    }
    expect(getPublicBookingService("anna-beauty")).toBe(remotePublicBookingService);
  });

  it("the shared adapter returns slots from the server and maps refusals to the errors the wizard already handles", async () => {
    expect(await remotePublicBookingService.getAvailableSlots("x-salon", "s", null, "2026-10-05")).toHaveLength(1);
    slotsResult = { ok: false, code: "not_found" };
    expect(await remotePublicBookingService.getAvailableSlots("x-salon", "s", null, "2026-10-05")).toEqual([]);
    slotsResult = { ok: false, code: "rate_limited", retryAfterSeconds: 30 };
    await expect(remotePublicBookingService.getAvailableSlots("x-salon", "s", null, "2026-10-05")).rejects.toBeInstanceOf(BookingRateLimitedError);

    await expect(remotePublicBookingService.createBooking("x-salon", request)).rejects.toBeInstanceOf(BookingUnavailableError);
    bookResult = { ok: false, code: "rate_limited" };
    await expect(remotePublicBookingService.createBooking("x-salon", request)).rejects.toBeInstanceOf(BookingRateLimitedError);
    bookResult = { ok: false, code: "unknown" };
    await expect(remotePublicBookingService.createBooking("x-salon", request)).rejects.toBeInstanceOf(BookingUnavailableError);
    bookResult = { ok: true, data: { appointmentId: "1", serviceId: "s", serviceName: "Cut", staffId: "s", staffName: "You", date: "2026-10-05", time: "09:00", status: "pending" } };
    expect((await remotePublicBookingService.createBooking("x-salon", request)).status).toBe("pending");
  });
});
