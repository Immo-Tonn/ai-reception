import { demoWorkspaces } from "@/features/workspace/registry";
import { getAppointmentsRepository } from "@/features/appointments/repository";
import { getClientsRepository } from "@/features/clients/repository";
import { normalizeEmail, normalizePhone } from "./createBooking";
import type { Appointment } from "@/features/appointments/types";
import type { ClientIdentity } from "@/features/clientAuth/types";

export interface ClientBookingRow {
  workspaceSlug: string;
  workspaceName: string;
  appointment: Appointment;
}

/**
 * "My Bookings" aggregates across every demo workspace (§ Client side is
 * a single UX spanning businesses, even though each ClientRecord stays
 * workspace-isolated — see HANDOFF_GRAPH.md §7). Matches this browser's
 * identity to a ClientRecord in each workspace the same way booking
 * itself does (normalized email OR phone), then reads that workspace's
 * own appointments repository — same data Business Calendar reads, so a
 * cancel/reschedule here shows up there immediately.
 */
export async function listMyBookings(identity: ClientIdentity): Promise<ClientBookingRow[]> {
  const normEmail = normalizeEmail(identity.email);
  const normPhone = normalizePhone(identity.phone);
  if (!normEmail && !normPhone) return [];

  const results = await Promise.all(
    demoWorkspaces.map(async (workspace) => {
      const clients = await getClientsRepository(workspace.slug).list();
      const match = clients.find(
        (c) =>
          (normEmail && normalizeEmail(c.email) === normEmail) ||
          (normPhone && normalizePhone(c.phone) === normPhone),
      );
      if (!match) return [];

      const appointments = await getAppointmentsRepository(workspace.slug).list();
      return appointments
        .filter((a) => a.client === match.name)
        .map((appointment): ClientBookingRow => ({
          workspaceSlug: workspace.slug,
          workspaceName: workspace.name,
          appointment,
        }));
    }),
  );

  return results.flat();
}
