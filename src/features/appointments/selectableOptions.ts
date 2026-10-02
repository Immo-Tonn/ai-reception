import type { FinancialBucket, Visibility } from "./types";

/**
 * Product-UI simplification: users pick between two Visibility values and
 * two Financial buckets. The wider enums (`ownerOnly`, `custom`) stay in
 * the domain model and database on purpose — they are hidden from the
 * normal create/edit forms, not removed, so the architecture keeps room
 * for them. Visibility and bucket remain two INDEPENDENT axes; nothing
 * here couples one to the other.
 */
export const selectableVisibilities: Visibility[] = ["normal", "private"];
export const selectableBuckets: FinancialBucket[] = ["main", "private"];

/**
 * Options to show in a form. If the record being edited already carries a
 * hidden legacy value (`ownerOnly` / `custom`), that value is appended so
 * it stays visible and selected — saving the form must never silently
 * rewrite existing data to a different value.
 */
export function visibilityOptions(current?: Visibility): Visibility[] {
  return current && !selectableVisibilities.includes(current)
    ? [...selectableVisibilities, current]
    : selectableVisibilities;
}

export function bucketOptions(current?: FinancialBucket): FinancialBucket[] {
  return current && !selectableBuckets.includes(current)
    ? [...selectableBuckets, current]
    : selectableBuckets;
}
