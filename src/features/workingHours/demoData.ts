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

export const demoWorkingHours: WorkingHoursProfile[] = [
  {
    ownerId: "business",
    weekly: standardWeek,
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
  {
    ownerId: "You",
    weekly: standardWeek,
    breaks: [],
    timeOff: [],
    blocks: [],
  },
];
