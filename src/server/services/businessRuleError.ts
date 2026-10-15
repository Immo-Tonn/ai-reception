export class BusinessRuleError extends Error {
  constructor(
    message: string,
    public code: | "staff_conflict"
      | "resource_conflict"
      | "outside_working_hours"
      | "service_inactive"
      | "resource_type_mismatch"
      | "invalid_work_transition"
      | "invalid_status_transition"
      | "delete_not_allowed",
  ) {
    super(message);
    this.name = "BusinessRuleError";
  }
}
