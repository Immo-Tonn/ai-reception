import { z } from "zod";
import { slotIntervalOptions } from "@/features/scheduling/types";
import { HHMM, MAX_INTERVALS_PER_DAY, minutesOf, normalizeWeekly, validateWeekly } from "@/features/scheduling/weeklyEdit";

/** Palette of staff colours: the design tokens of the accent family (src/styles/tokens.css). */
export const staffColorTokens = [
  "--color-accent-blue",
  "--color-accent-sky",
  "--color-accent-mint",
  "--color-accent-lime",
  "--color-accent-peach",
  "--color-accent-pink",
  "--color-accent-lavender",
  "--color-accent-yellow",
] as const;

/** The database enum `resource_type` (0002). */
export const resourceTypes = ["room", "vehicle", "equipment", "custom"] as const;

const uuid = z.string().uuid();
const idList = z.array(uuid).max(200).transform((ids) => [...new Set(ids)]);

const interval = z.object({ start: z.string().regex(HHMM), end: z.string().regex(HHMM) });

/**
 * Weekly intervals: keys "0".."6" (0 = Sunday), HH:mm, end > start, no overlap, at most 4 per day.
 * A missing or empty day is closed. Output: all seven days, sorted.
 */
export const weeklyIntervalsSchema = z
  .record(z.string().regex(/^[0-6]$/), z.array(interval).max(MAX_INTERVALS_PER_DAY))
  .superRefine((value, ctx) => {
    const issue = validateWeekly(Object.fromEntries(Object.entries(value).map(([k, v]) => [Number(k), v])));
    if (issue) ctx.addIssue({ code: "custom", message: `${issue.code}:${issue.weekday}` });
  })
  .transform((value) => normalizeWeekly(Object.fromEntries(Object.entries(value).map(([k, v]) => [Number(k), v]))));

export const createStaffSchema = z.object({
  name: z.string().trim().min(1).max(80),
  title: z.string().trim().max(80).default(""),
  colorToken: z.enum(staffColorTokens).default("--color-accent-blue"),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  serviceIds: idList.default([]),
});

export const updateStaffSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    title: z.string().trim().max(80),
    colorToken: z.enum(staffColorTokens),
    sortOrder: z.number().int().min(0).max(9999),
    serviceIds: idList,
  })
  .partial();

export const staffScheduleSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("inherit") }),
  z.object({ mode: z.literal("custom"), weekly: weeklyIntervalsSchema }),
]);

export const createResourceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(resourceTypes),
  description: z.string().trim().max(500).default(""),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  serviceIds: idList.default([]),
});

export const updateResourceSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    type: z.enum(resourceTypes),
    description: z.string().trim().max(500),
    sortOrder: z.number().int().min(0).max(9999),
    serviceIds: idList,
  })
  .partial();

function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}
const dateString = z.string().refine(isCalendarDate);

/**
 * Time off / closure. `staffId` null = the whole business. Full days: no times, startDate <= endDate.
 * Partial day: both times, same date, end > start. The reason is private to the business.
 */
export const createTimeOffSchema = z
  .object({
    staffId: uuid.nullable(),
    startDate: dateString,
    endDate: dateString,
    startTime: z.string().regex(HHMM).nullable().default(null),
    endTime: z.string().regex(HHMM).nullable().default(null),
    reason: z.string().trim().max(200).default(""),
  })
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) ctx.addIssue({ code: "custom", message: "end_before_start", path: ["endDate"] });
    const partial = v.startTime !== null || v.endTime !== null;
    if (!partial) return;
    if (v.startTime === null || v.endTime === null) ctx.addIssue({ code: "custom", message: "partial_needs_both_times" });
    else if (minutesOf(v.endTime) <= minutesOf(v.startTime)) ctx.addIssue({ code: "custom", message: "end_not_after_start", path: ["endTime"] });
    if (v.startDate !== v.endDate) ctx.addIssue({ code: "custom", message: "partial_is_one_day", path: ["endDate"] });
  });

export const bookingRulesSchema = z
  .object({
    autoConfirm: z.boolean(),
    minNoticeMinutes: z.number().int().min(0).max(60 * 24 * 30),
    maxHorizonDays: z.number().int().min(1).max(180),
    slotIntervalMinutes: z.number().refine((n) => (slotIntervalOptions as readonly number[]).includes(n)),
    cancellationDeadlineHours: z.number().int().min(0).max(720),
    rescheduleDeadlineHours: z.number().int().min(0).max(720),
  })
  // A notice period at least as long as the horizon would leave no bookable day at all.
  .refine((v) => v.minNoticeMinutes < v.maxHorizonDays * 24 * 60, { message: "notice_exceeds_horizon", path: ["minNoticeMinutes"] });

export type CreateStaffInput = z.input<typeof createStaffSchema>;
export type UpdateStaffInput = z.input<typeof updateStaffSchema>;
export type StaffScheduleInput = z.input<typeof staffScheduleSchema>;
export type CreateResourceInput = z.input<typeof createResourceSchema>;
export type UpdateResourceInput = z.input<typeof updateResourceSchema>;
export type CreateTimeOffInput = z.input<typeof createTimeOffSchema>;
export type BookingRulesInput = z.input<typeof bookingRulesSchema>;
