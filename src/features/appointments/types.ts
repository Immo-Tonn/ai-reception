/**
 * Appointment domain types — SPEC.md §6, §7, §9, §69.
 *
 * Visibility and financial bucket are deliberately separate fields, never
 * a single flag: a record can be Visibility=PRIVATE with
 * FinancialBucket=MAIN, or any other combination (§7.1, §97 non-negotiable
 * requirement #6).
 */

export type Visibility = "normal" | "private" | "ownerOnly" | "custom";

export type FinancialBucket = "main" | "private" | "custom";

export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "checkedIn"
  | "inProgress"
  | "completed"
  | "cancelled"
  | "noShow"
  | "rescheduled";

export type RecurrenceFrequency = "weekly" | "biweekly" | "monthly" | "custom";

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  /** Only used when frequency === "custom" — interval in days. */
  intervalDays?: number;
  count: number;
}

export interface Appointment {
  id: string;
  client: string;
  service: string;
  staff: string;
  resourceId: string | null;
  date: string; // ISO date, e.g. "2026-09-22"
  time: string; // "HH:mm"
  durationMinutes: number;
  price: number;
  currency: string;
  notes: string;
  visibility: Visibility;
  financialBucket: FinancialBucket;
  status: AppointmentStatus;
  paid: boolean;
  /** Present on every occurrence of a recurring series, shared by all of them. */
  seriesId: string | null;
  recurrence: RecurrenceRule | null;
  /** Real database ids — only set for Supabase-backed (real) workspaces.
   * The display fields above (`client`, `service`, `staff`) stay the
   * human-readable names every UI component already uses; when an id is
   * present it is preferred over a name lookup, so two clients who share
   * a name can never be confused. Demo workspaces never set these. */
  clientId?: string | null;
  serviceId?: string | null;
  staffId?: string | null;
  /** Where the booking came from. Defaults to "user" (entered by staff);
   * "public" marks one made by a visitor through the online booking page. */
  source?: "user" | "public" | "assistant" | "automation";
}
