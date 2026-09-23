export type ClientTag = "vip" | "new";

export interface ClientCustomField {
  label: string;
  value: string;
}

export interface ClientRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  tags: ClientTag[];
  lastVisit: string | null; // ISO date
  upcoming: { date: string; time: string; service: string }[];
  history: { date: string; service: string; price: number }[];
  notes: string;
  /** Industry-specific extra fields (e.g. Kennzeichen/VIN for a
   * Werkstatt vehicle, address/rooms for a Cleaning property) — a plain
   * label/value bag so one ClientRecord shape covers every workspace
   * preset without a separate schema per industry. Optional so existing
   * records/tests are unaffected. */
  customFields?: ClientCustomField[];
}
