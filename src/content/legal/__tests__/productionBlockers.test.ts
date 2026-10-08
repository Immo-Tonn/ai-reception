import { describe, expect, it } from "vitest";
import { datenschutzApproved, datenschutzLastUpdated } from "../datenschutz";
import { impressumApproved, missingImpressumFields } from "../impressum";

/**
 * Release blockers. Skipped (listed, not red) in the normal `vitest run`.
 * `npm run check:legal` sets LEGAL_RELEASE_CHECK=1 and FAILS while the
 * Datenschutz placeholder / Impressum TODOs exist. See docs/LEGAL_TODO.md.
 */
const enabled = process.env.LEGAL_RELEASE_CHECK === "1";

describe("PRODUCTION BLOCKERS (legal)", () => {
  it.runIf(enabled)("BLOCKER: Datenschutzerklärung is approved (datenschutzApproved === true)", () => {
    expect(datenschutzApproved).toBe(true);
    expect(datenschutzLastUpdated).not.toBeNull();
  });

  it.runIf(enabled)("BLOCKER: Impressum has no TODO fields and is approved", () => {
    expect(missingImpressumFields().map((f) => f.id)).toEqual([]);
    expect(impressumApproved).toBe(true);
  });

  it.skipIf(enabled)("(skipped by default) legal release blockers run with `npm run check:legal`", () => {});
});
