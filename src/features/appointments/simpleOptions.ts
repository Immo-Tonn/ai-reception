import type { FinancialBucket, Visibility } from "./types";

/**
 * Everyday forms offer two simple choices per axis (Visibility: normal/private, Finance: main/private).
 * The advanced values (ownerOnly, custom) stay in the domain/DB/API; they are shown ONLY when the record
 * being edited already has one, so editing never silently loses it. The two axes stay independent.
 */
export function visibilityChoices(initial: Visibility | undefined): Visibility[] {
  const simple: Visibility[] = ["normal", "private"];
  return initial && !simple.includes(initial) ? [...simple, initial] : simple;
}

export function financialBucketChoices(initial: FinancialBucket | undefined): FinancialBucket[] {
  const simple: FinancialBucket[] = ["main", "private"];
  return initial && !simple.includes(initial) ? [...simple, initial] : simple;
}
