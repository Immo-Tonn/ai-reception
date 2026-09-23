import type { WorkspaceConfig } from "../types";
import { demoServices } from "@/features/services/demoData";
import { demoStaff } from "@/features/staff/demoData";
import { demoResources } from "@/features/resources/demoData";
import { demoClients } from "@/features/clients/demoData";
import { demoAppointments } from "@/features/appointments/demoData";

/**
 * Beauty / Salon — the original demo content, unchanged, just wrapped as
 * the "salon" preset so it goes through the same WorkspaceConfig path as
 * every other industry.
 */
export const salonWorkspace: WorkspaceConfig = {
  slug: "demo-salon",
  industry: "salon",
  name: "Beauty Salon",
  tagline: "Haircuts, color, brows, massage",
  emoji: "💇",
  services: demoServices,
  staff: demoStaff,
  resources: demoResources,
  clients: demoClients.map((client) =>
    client.id === "anna-muller"
      ? {
          ...client,
          customFields: [{ label: "Preferred specialist", value: "Elena" }],
        }
      : client,
  ),
  appointments: demoAppointments,
};
