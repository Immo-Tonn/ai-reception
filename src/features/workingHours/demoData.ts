import type { WorkingHoursProfile } from "./types";

const standardWeek = {
  0: null,
  1: { start: "09:00", end: "18:00" },
  2: { start: "09:00", end: "18:00" },
  3: { start: "09:00", end: "18:00" },
  4: { start: "09:00", end: "18:00" },
  5: { start: "09:00", end: "18:00" },
  6: null,
};

// The business opens Saturday 10-14 so Marco's own Saturday hours stay inside it: staff hours
// are INTERSECTED with the business hours (docs/STAFF_SCHEDULING.md). Everyone else is off on
// Saturday in their own profile, so only Marco is bookable then (same behaviour as before).
export const demoWorkingHours: WorkingHoursProfile[] = [
  {
    ownerId: "business",
    weekly: { ...standardWeek, 6: { start: "10:00", end: "14:00" } },
    breaks: [],
    timeOff: [],
    blocks: [],
  },
  {
    ownerId: "Elena",
    weekly: standardWeek,
    breaks: [{ weekday: 1, start: "13:00", end: "14:00" }],
    timeOff: [],
    blocks: [],
  },
  {
    ownerId: "Marco",
    weekly: { ...standardWeek, 6: { start: "10:00", end: "14:00" } },
    breaks: [],
    timeOff: [{ startDate: "2026-09-25", endDate: "2026-09-27", reason: "Vacation" }],
    blocks: [],
  },
  // Staff of the other demo industries: explicit Mon-Fri hours (no Saturday), as the business default used to give them.
  ...["Julia", "Tom", "Sven"].map(
    (ownerId): WorkingHoursProfile => ({ ownerId, weekly: standardWeek, breaks: [], timeOff: [], blocks: [] }),
  ),
  {
    ownerId: "You",
    weekly: standardWeek,
    breaks: [],
    timeOff: [],
    blocks: [],
  },
];
