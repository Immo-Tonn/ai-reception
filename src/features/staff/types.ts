export interface StaffMember {
  id: string;
  name: string;
  colorToken: string; // CSS custom property name, e.g. "--color-accent-blue"
  /** Job title shown to customers (optional). */
  title?: string;
  /** Archived staff are `false`: never offered, still resolve for history. Absent = active. */
  active?: boolean;
  /** "inherit" = business hours, "custom" = own hours (see docs/STAFF_SCHEDULING.md). Absent = custom when own hours exist. */
  scheduleMode?: "inherit" | "custom";
  sortOrder?: number;
}
