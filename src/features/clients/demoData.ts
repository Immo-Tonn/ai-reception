import type { ClientRecord } from "./types";

/** Demo data for the design/navigation pass only (§98 — real data comes later). */
export const demoClients: ClientRecord[] = [
  {
    id: "anna-muller",
    name: "Anna Müller",
    email: "anna.muller@example.com",
    phone: "+49 151 2345 6789",
    tags: ["vip"],
    lastVisit: "2026-09-08",
    upcoming: [{ date: "2026-09-22", time: "09:00", service: "Haircut" }],
    history: [
      { date: "2026-09-08", service: "Haircut", price: 55 },
      { date: "2026-08-11", service: "Color", price: 95 },
    ],
    notes: "Prefers appointments in the morning. Allergic to ammonia-based dye.",
  },
  {
    id: "jonas-schmidt",
    name: "Jonas Schmidt",
    email: "jonas.schmidt@example.com",
    phone: "+49 160 1122 3344",
    tags: ["new"],
    lastVisit: null,
    upcoming: [{ date: "2026-09-22", time: "10:30", service: "Consultation" }],
    history: [],
    notes: "",
  },
  {
    id: "laura-fischer",
    name: "Laura Fischer",
    email: "laura.fischer@example.com",
    phone: "+49 176 9988 7766",
    tags: [],
    lastVisit: "2026-09-15",
    upcoming: [{ date: "2026-09-22", time: "16:00", service: "Deep cleaning" }],
    history: [
      { date: "2026-09-15", service: "Regular cleaning", price: 80 },
      { date: "2026-09-01", service: "Regular cleaning", price: 80 },
      { date: "2026-08-18", service: "Deep cleaning", price: 120 },
    ],
    notes: "Has a dog — leave the back door closed.",
  },
  {
    id: "mia-weber",
    name: "Mia Weber",
    email: "mia.weber@example.com",
    phone: "+49 152 4433 2211",
    tags: ["vip"],
    lastVisit: "2026-07-30",
    upcoming: [],
    history: [{ date: "2026-07-30", service: "Website maintenance", price: 180 }],
    notes: "",
  },
];
