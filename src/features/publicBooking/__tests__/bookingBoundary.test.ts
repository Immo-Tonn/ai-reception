import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getPublicBookingService, BookingUnavailableError } from "../bookingService";
import { buildPublicAppointment, matchExistingClient } from "../bookingRules";
import { findWorkspaceConfig } from "@/features/workspace/registry";
import { getAppointmentsRepository } from "@/features/appointments/repository";
import { getClientsRepository } from "@/features/clients/repository";
import type { ClientRecord } from "@/features/clients/types";

// The local demo adapter persists to window.localStorage; give Node a tiny one.
function installFakeLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
}

const slug = "demo-salon";
// A Tuesday far in the future: inside working hours, never "in the past".
const date = "2099-01-06";
const guest = { name: "Test Guest", email: "guest@example.com", phone: "+49 170 0000000", notes: "" };

describe("Public Booking application boundary", () => {
  beforeEach(installFakeLocalStorage);

  it("books through PublicBookingService and returns a result for the success screen", async () => {
    const service = getPublicBookingService();
    const salon = findWorkspaceConfig(slug)!;
    const svc = salon.services[0];

    const slots = await service.getAvailableSlots(slug, svc.id, null, date);
    expect(slots.length).toBeGreaterThan(0);

    const result = await service.createBooking(slug, {
      serviceId: svc.id,
      staffId: null,
      date,
      time: slots[0].time,
      client: guest,
    });

    expect(result).toMatchObject({ serviceId: svc.id, date, time: slots[0].time, status: "pending" });
    expect(result.staffName).toBeTruthy();

    const stored = (await getAppointmentsRepository(slug).list()).find((a) => a.id === result.appointmentId)!;
    expect(stored).toMatchObject({
      visibility: "normal",
      financialBucket: "main",
      status: "pending",
      staffId: result.staffId,
      serviceId: svc.id,
    });
    const client = (await getClientsRepository(slug).list()).find((c) => c.id === stored.clientId);
    expect(client?.email).toBe(guest.email);
  });

  it("re-validates at write time: the same specialist+time cannot be booked twice", async () => {
    const service = getPublicBookingService();
    const svc = findWorkspaceConfig(slug)!.services[0];
    const staffId = (await service.getAvailableSlots(slug, svc.id, null, date))[0].staffId;
    const request = { serviceId: svc.id, staffId, date, time: "09:00", client: guest };

    await service.createBooking(slug, request);
    await expect(service.createBooking(slug, request)).rejects.toBeInstanceOf(BookingUnavailableError);
  });

  it("reuses the client record instead of duplicating it, and links by clientId", async () => {
    const service = getPublicBookingService();
    const svc = findWorkspaceConfig(slug)!.services[0];
    const first = await service.createBooking(slug, {
      serviceId: svc.id, staffId: null, date, time: "13:00", client: guest,
    });
    const second = await service.createBooking(slug, {
      serviceId: svc.id, staffId: null, date, time: "15:00", client: { ...guest, name: "Renamed Guest" },
    });
    const appts = await getAppointmentsRepository(slug).list();
    const a = appts.find((x) => x.id === first.appointmentId)!;
    const b = appts.find((x) => x.id === second.appointmentId)!;
    expect(a.clientId).toBeDefined();
    expect(a.clientId).toBe(b.clientId);
  });

  it("an unknown workspace offers no slots and cannot be booked", async () => {
    const service = getPublicBookingService();
    expect(await service.getAvailableSlots("nope", "svc-haircut", null, date)).toEqual([]);
    await expect(
      service.createBooking("nope", { serviceId: "svc-haircut", staffId: null, date, time: "09:00", client: guest }),
    ).rejects.toBeInstanceOf(BookingUnavailableError);
  });

  it("BookingWizard talks only to the service — no repositories/localStorage in the UI", () => {
    const wizard = readFileSync(
      path.resolve(__dirname, "../../../app/book/[workspaceSlug]/BookingWizard.tsx"),
      "utf8",
    );
    expect(wizard).toContain("getPublicBookingService");
    expect(wizard).not.toMatch(/repository|localStorage|localDemoBookingService/i);
  });
});

describe("shared booking rules", () => {
  const client = (id: string, email: string, phone: string): ClientRecord => ({
    id, name: id, email, phone, tags: [], lastVisit: null, upcoming: [], history: [], notes: "",
  });

  it("matches by email OR phone, and refuses to guess when they point at different records", () => {
    const list = [client("a", "a@x.de", "+49 1"), client("b", "b@x.de", "+49 2")];
    expect(matchExistingClient(list, { email: " A@x.de ", phone: "" })?.id).toBe("a");
    expect(matchExistingClient(list, { email: "", phone: "+49 2" })?.id).toBe("b");
    expect(matchExistingClient(list, { email: "a@x.de", phone: "+49 2" })).toBeUndefined();
  });

  it("a public appointment is always pending / normal / main and carries stable ids", () => {
    const svc = findWorkspaceConfig(slug)!.services[0];
    const appt = buildPublicAppointment({
      id: "1", service: svc, date, time: "09:00", notes: "",
      slot: { time: "09:00", staffId: "s1", staffName: "S", resourceId: null },
      client: client("c1", "a@x.de", ""),
    });
    expect(appt).toMatchObject({
      status: "pending", visibility: "normal", financialBucket: "main",
      clientId: "c1", staffId: "s1", serviceId: svc.id,
    });
  });
});
