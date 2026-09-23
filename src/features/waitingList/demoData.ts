import type { WaitingListEntry } from "./types";

export const demoWaitingList: WaitingListEntry[] = [
  {
    id: "wl-1",
    client: "Mia Weber",
    service: "Haircut",
    preferredStaff: "Elena",
    earliestDate: "2026-09-22",
    latestDate: "2026-09-30",
    preferredDays: [],
    preferredTimeStart: "14:00",
    preferredTimeEnd: "18:00",
  },
  {
    id: "wl-2",
    client: "Jonas Schmidt",
    service: "Consultation",
    preferredStaff: null,
    earliestDate: "2026-09-22",
    latestDate: "2026-09-25",
    preferredDays: [],
    preferredTimeStart: null,
    preferredTimeEnd: null,
  },
];
