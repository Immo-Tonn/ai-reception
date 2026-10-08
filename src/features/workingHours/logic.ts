import type { WorkingHoursProfile } from "./types";
import {
  dayIntervals,
  fitsInside,
  intersectIntervals,
  mergeIntervals,
  overlaps,
  subtractIntervals,
  toMinutes,
  weekdayOf,
  type MinuteInterval,
} from "@/features/scheduling/intervals";

function dateInRange(date: string, startDate: string, endDate: string): boolean {
  return date >= startDate && date <= endDate;
}

export interface AvailabilityCheck {
  available: boolean;
  reason?: "dayOff" | "outsideHours" | "onBreak" | "timeOff" | "blocked";
}

/** What one person may do on one workspace-local date (docs/STAFF_SCHEDULING.md). */
export interface DayResolution {
  /** A full-day time off / closure (business OR staff) covers the date. */
  fullDayOff: boolean;
  /** Business intervals INTERSECT staff intervals (before breaks and partial time off). Empty = day off. */
  base: MinuteInterval[];
  breaks: MinuteInterval[];
  /** Partial-day time off and manual blocks (business and staff). */
  blocks: MinuteInterval[];
  /** `base` minus breaks minus blocks: where a service may be placed. Empty when `fullDayOff`. */
  effective: MinuteInterval[];
  /** Neither a business nor a staff profile exists (legacy/test callers): nothing restricts the day. */
  unrestricted: boolean;
}

function findProfiles(ownerId: string, profiles: WorkingHoursProfile[], ownerAlias?: string) {
  const business = profiles.find((p) => p.ownerId === "business");
  const staff =
    ownerId === "business"
      ? undefined
      : (profiles.find((p) => p.ownerId === ownerId) ??
        (ownerAlias && ownerAlias !== "business" ? profiles.find((p) => p.ownerId === ownerAlias) : undefined));
  return { business, staff };
}

/**
 * THE rule for working hours. Effective hours = business intervals
 * INTERSECT staff intervals; a staff profile in `inherit` mode (or no staff
 * profile at all) works exactly the business hours, `custom` (the default
 * when a staff profile exists) can only narrow them. Business closures and
 * time off apply to everyone on top of any staff profile. No profile at all
 * (neither business nor staff) = unrestricted (legacy/test callers; real
 * workspaces are default-deny, see workingHoursMapper).
 */
export function resolveDay(
  ownerId: string,
  date: string,
  profiles: WorkingHoursProfile[],
  ownerAlias?: string,
): DayResolution {
  // `ownerId` is the stable staff id; `ownerAlias` (the staff display name)
  // only exists so demo profiles keyed by name keep matching.
  const { business, staff } = findProfiles(ownerId, profiles, ownerAlias);
  const weekday = weekdayOf(date);
  const used = [business, staff].filter((p): p is WorkingHoursProfile => Boolean(p));

  const fullDayOff = used.some((p) => p.timeOff.some((r) => dateInRange(date, r.startDate, r.endDate)));

  let base: MinuteInterval[];
  if (used.length === 0) {
    base = [{ start: 0, end: 24 * 60 }];
  } else {
    const businessBase = business ? dayIntervals(business.weekly[weekday]) : null;
    const staffBase = staff ? dayIntervals(staff.weekly[weekday]) : null;
    if (businessBase && staffBase && staff?.mode !== "inherit") base = intersectIntervals(businessBase, staffBase);
    else base = businessBase ?? staffBase ?? [];
  }

  const breaks = mergeIntervals(
    used.flatMap((p) =>
      p.breaks.filter((b) => b.weekday === weekday).map((b) => ({ start: toMinutes(b.start), end: toMinutes(b.end) })),
    ),
  );
  const blocks = mergeIntervals(
    used.flatMap((p) => p.blocks.filter((b) => b.date === date).map((b) => ({ start: toMinutes(b.start), end: toMinutes(b.end) }))),
  );

  const effective = fullDayOff ? [] : subtractIntervals(subtractIntervals(base, breaks), blocks);
  return { fullDayOff, base, breaks, blocks, effective, unrestricted: used.length === 0 };
}

/**
 * Checks a candidate slot against the effective hours of a person: business
 * hours, individual hours (intersection), breaks, days off, vacation /
 * closures, partial time off and manual blocks. The slot must fit entirely
 * inside ONE effective interval.
 */
export function checkAvailability(
  ownerId: string,
  date: string,
  time: string,
  durationMinutes: number,
  profiles: WorkingHoursProfile[],
  ownerAlias?: string,
): AvailabilityCheck {
  const day = resolveDay(ownerId, date, profiles, ownerAlias);
  const start = toMinutes(time);
  const end = start + durationMinutes;

  if (day.fullDayOff) return { available: false, reason: "timeOff" };
  if (overlaps(day.blocks, start, end)) return { available: false, reason: "blocked" };
  if (day.base.length === 0) return { available: false, reason: "dayOff" };
  if (!fitsInside(day.base, start, end)) return { available: false, reason: "outsideHours" };
  if (overlaps(day.breaks, start, end)) return { available: false, reason: "onBreak" };
  return { available: true };
}
