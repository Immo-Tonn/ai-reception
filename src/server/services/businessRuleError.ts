export class BusinessRuleError extends Error {
  constructor(
    message: string,
    public code: "staff_conflict" | "resource_conflict" | "outside_working_hours" | "service_inactive",
  ) {
    super(message);
    this.name = "BusinessRuleError";
  }
}
