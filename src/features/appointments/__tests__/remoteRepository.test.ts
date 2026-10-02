import { describe, expect, it, vi } from "vitest";
import type { Appointment } from "../types";

// Plain stand-ins for the Server Actions (they run on the server in production).
const sent: { create: unknown[]; update: unknown[] } = { create: [], update: [] };
const nextSeries = "11111111-2222-4333-8444-555555555555";
let failWith: string | null = null;

vi.mock("@/server/actions/appointments.actions", () => ({
  listAppointmentsAction: async () => ({
    ok: true,
    data: [
      { id: "a1", client: "Anna", service: "Cut", staff: "You", resourceId: null, date: "2026-10-05", time: "09:00", durationMinutes: 30, price: 40, currency: "EUR", notes: "", visibility: "normal", financialBucket: "main", status: "confirmed", paid: false, seriesId: null, recurrence: null, masked: false },
      { id: "a2", date: "2026-10-05", time: "10:00", durationMinutes: 30, staff: "You", status: "confirmed", visibility: "private", masked: true },
    ],
  }),
  getAppointmentAction: async () => ({ ok: true, data: undefined }),
  createAppointmentAction: async (_slug: string, input: Record<string, unknown>) =>
    failWith ? { ok: false, code: failWith } : (sent.create.push(input), { ok: true, data: { ...input, id: `new-${sent.create.length}`, seriesId: input.recurrence ? nextSeries : null } }),
  updateAppointmentAction: async (_slug: string, id: string, input: unknown) => (sent.update.push({ id, input }), { ok: true, data: { id } }),
  removeAppointmentAction: async () => ({ ok: true, data: null }),
}));

const { createRemoteAppointmentsRepository } = await import("../remoteRepository");
const { RemoteRepositoryError } = await import("@/lib/repository/createRemoteRepository");

const base: Appointment = {
  id: "local-1", client: "Anna", clientId: "c", service: "Cut", serviceId: "s", staff: "You", staffId: "st", resourceId: null,
  date: "2026-10-05", time: "09:00", durationMinutes: 30, price: 40, currency: "EUR", notes: "", visibility: "normal",
  financialBucket: "main", status: "confirmed", paid: false, seriesId: null, recurrence: null,
};

describe("remote appointments repository (real workspace)", () => {
  it("lists through the server; a masked entry becomes a neutral 'busy' placeholder", async () => {
    const list = await createRemoteAppointmentsRepository("my-salon").list();
    expect(list[0]).toMatchObject({ client: "Anna" });
    expect(list[1]).toMatchObject({ client: "", service: "", price: 0, visibility: "private", time: "10:00" });
    expect("masked" in list[0]).toBe(false);
  });

  it("sends only writable fields: the browser's temporary id never reaches the server", async () => {
    sent.create.length = 0;
    await createRemoteAppointmentsRepository("my-salon").create(base);
    const payload = sent.create[0] as Record<string, unknown>;
    expect("id" in payload).toBe(false);
    expect(payload).toMatchObject({ clientId: "c", serviceId: "s", staffId: "st", date: "2026-10-05", visibility: "normal", financialBucket: "main" });
  });

  it("recurring series: later occurrences join the series the server created for the first", async () => {
    sent.create.length = 0;
    const repo = createRemoteAppointmentsRepository("my-salon");
    const rule = { frequency: "weekly" as const, count: 3 };
    const first = await repo.create({ ...base, seriesId: "series-temp", recurrence: rule });
    await repo.create({ ...base, date: "2026-10-12", seriesId: "series-temp", recurrence: rule });
    expect(first.seriesId).toBe(nextSeries);
    expect((sent.create[0] as { seriesId: string }).seriesId).toBe("series-temp");
    expect((sent.create[1] as { seriesId: string }).seriesId).toBe(nextSeries);
  });

  it("an update never sends ids, series or recurrence from the browser", async () => {
    sent.update.length = 0;
    await createRemoteAppointmentsRepository("my-salon").update("x", { ...base, time: "11:00" });
    const { input } = sent.update[0] as { input: Record<string, unknown> };
    expect(input.time).toBe("11:00");
    for (const k of ["id", "seriesId", "recurrence"]) expect(k in input).toBe(false);
  });

  it("a refusal surfaces as a RemoteRepositoryError carrying only a code", async () => {
    failWith = "conflict";
    const error = await createRemoteAppointmentsRepository("my-salon").create(base).then(() => null, (e: unknown) => e);
    failWith = null;
    expect(error).toBeInstanceOf(RemoteRepositoryError);
    expect((error as InstanceType<typeof RemoteRepositoryError>).code).toBe("conflict");
  });
});
