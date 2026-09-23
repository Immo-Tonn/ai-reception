/** 0 = Sunday, matching Date#getDay(). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface TimeRange {
  start: string; // "HH:mm"
  end: string; // "HH:mm"
}

export interface WeeklySchedule {
  /** `null` for a weekday means that day is off. */
  [weekday: number]: TimeRange | null;
}

export interface DateRange {
  startDate: string; // ISO date, inclusive
  endDate: string; // ISO date, inclusive
  reason?: string;
}

export interface BlockedSlot {
  date: string; // ISO date
  start: string;
  end: string;
  reason?: string;
}

export interface WorkingHoursProfile {
  /** "business" = workspace default; otherwise a staff id/name. */
  ownerId: string;
  weekly: WeeklySchedule;
  breaks: { weekday: Weekday; start: string; end: string }[];
  timeOff: DateRange[]; // vacations / absences
  blocks: BlockedSlot[]; // manually blocked one-off time
}
