export interface ServiceDefinition {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  currency: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  allowedStaffIds: string[]; // empty = all staff allowed
  requiredResourceType: string | null; // e.g. "room" — null = no resource needed
}
