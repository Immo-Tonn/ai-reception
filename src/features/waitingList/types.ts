export type WaitingListStatus = "waiting" | "contacted" | "booked" | "closed";

export const WAITING_LIST_STATUSES: readonly WaitingListStatus[] = ["waiting", "contacted", "booked", "closed"];

/** Entries that still want a slot. Booked/closed entries are history only. */
export const isActiveWaitingStatus = (status: WaitingListStatus | undefined): boolean =>
  status === undefined || status === "waiting" || status === "contacted";

export interface WaitingListEntry {
  id: string;
  /** Display name: the linked client's name, or the guest's name. */
  client: string;
  /** Display name of the service (resolved from `serviceId` on real workspaces). */
  service: string;
  preferredStaff: string | null; // null = no preference
  earliestDate: string;
  latestDate: string;
  preferredDays: number[]; // 0-6, empty = any day
  preferredTimeStart: string | null;
  preferredTimeEnd: string | null;
  // Real-workspace fields (optional so demo / local records keep working).
  clientId?: string | null;
  serviceId?: string | null;
  preferredStaffId?: string | null;
  guestPhone?: string;
  guestEmail?: string;
  notes?: string;
  status?: WaitingListStatus;
  bookedAppointmentId?: string | null;
  createdAt?: string;
}
