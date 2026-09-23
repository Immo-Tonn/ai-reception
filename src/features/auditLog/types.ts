/** Local demo audit log — SPEC.md §64, item 9 of the Calendar task. */
export interface AuditLogEntry {
  id: string;
  timestamp: string; // ISO datetime
  action:
    | "created"
    | "updated"
    | "moved"
    | "statusChanged"
    | "cancelled"
    | "deleted";
  entityType:
    | "appointment"
    | "invoice"
    | "client"
    | "waitingListEntry"
    | "lead"
    | "quote"
    | "job"
    | "project";
  entityId: string;
  summary: string; // human-readable, already localized at write time
  source: "user" | "assistant" | "automation" | "public";
}
