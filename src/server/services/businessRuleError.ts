export class BusinessRuleError extends Error {
  constructor(
    message: string,
    public code: "staff_conflict" | "resource_conflict" | "outside_working_hours" | "service_inactive" | "resource_type_mismatch",
  ) {
    super(message);
    this.name = "BusinessRuleError";
  }
}
