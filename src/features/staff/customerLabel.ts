/**
 * Customer-facing staff display (booking wizard, confirmation, My bookings, reschedule).
 *
 * The owner's default staff row is stored literally as "You": an internal placeholder that is
 * localized for the OWNER via `getStaffLabel`. A customer must never read it as a specialist
 * name, so every client-facing place goes through this helper instead:
 *  - a real staff name is shown untouched (trimmed);
 *  - the placeholder (any case/whitespace, or its localized forms) becomes the business name,
 *    falling back to the neutral "Specialist" label.
 * Pure: no ids, no profile data, no i18n lookup (labels are passed in).
 */
const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set(["you", "du", "sie", "ви", "вы"]);

export interface CustomerStaffLabelOptions {
  /** Business name used in place of the placeholder (preferred). */
  businessName?: string | null;
  /** Neutral localized fallback, e.g. "Specialist". */
  neutralLabel: string;
}

export function isPlaceholderStaffName(name: string | null | undefined): boolean {
  if (typeof name !== "string") return true;
  const n = name.trim().toLowerCase();
  return n === "" || PLACEHOLDER_NAMES.has(n);
}

export function customerStaffLabel(staffName: string | null | undefined, options: CustomerStaffLabelOptions): string {
  if (!isPlaceholderStaffName(staffName)) return (staffName as string).trim();
  const business = options.businessName?.trim();
  return business ? business : options.neutralLabel;
}
