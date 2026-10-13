export class BusinessRuleError extends Error {
  constructor(
    message: string,
    public code: | "staff_conflict"
      | "resource_conflict"
      | "outside_working_hours"
      | "service_inactive"
      | "resource_type_mismatch"
      | "invalid_work_transition"
      | "external_calendar_busy"
      | "external_calendar_unconfirmed",
  ) {
    super(message);
    this.name = "BusinessRuleError";
  }
}
