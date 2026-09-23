export interface WaitingListEntry {
  id: string;
  client: string;
  service: string;
  preferredStaff: string | null; // null = no preference
  earliestDate: string;
  latestDate: string;
  preferredDays: number[]; // 0-6, empty = any day
  preferredTimeStart: string | null;
  preferredTimeEnd: string | null;
}
