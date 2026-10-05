import "server-only";
import type { Session } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RepositoryNotFoundError, toRepositoryError } from "@/server/repository/errors";
import { defaultBookingRules, type BookingRules } from "@/features/scheduling/types";
import { bookingRulesSchema, type BookingRulesInput } from "@/server/validation/scheduling.schema";
import { assertCanRead, assertCanWrite, audit } from "./schedulingShared";

/**
 * Booking rules = columns on `workspaces` (RLS: workspaces_update needs `settings.manage`).
 * `auto_confirm_bookings` is the pre-existing switch; the rest come from migration 0019.
 * Permission: `settings.manage`.
 */
const COLUMNS = "name,auto_confirm_bookings,min_notice_minutes,max_horizon_days,slot_interval_minutes,cancellation_deadline_hours,reschedule_deadline_hours";
type Row = Record<string, unknown>;

function fromRow(r: Row): BookingRules {
  const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
  return {
    autoConfirm: r.auto_confirm_bookings === true,
    minNoticeMinutes: num(r.min_notice_minutes, defaultBookingRules.minNoticeMinutes),
    maxHorizonDays: num(r.max_horizon_days, defaultBookingRules.maxHorizonDays),
    slotIntervalMinutes: num(r.slot_interval_minutes, defaultBookingRules.slotIntervalMinutes),
    cancellationDeadlineHours: num(r.cancellation_deadline_hours, defaultBookingRules.cancellationDeadlineHours),
    rescheduleDeadlineHours: num(r.reschedule_deadline_hours, defaultBookingRules.rescheduleDeadlineHours),
  };
}

export async function getBookingRules(session: Session): Promise<BookingRules & { businessName: string }> {
  assertCanRead(session, "settings.manage");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.from("workspaces").select(COLUMNS).eq("id", session.workspaceId).maybeSingle();
  if (error || !data) throw new RepositoryNotFoundError("bookingRules.get");
  return { ...fromRow(data as Row), businessName: (data as Row).name as string };
}

export async function updateBookingRules(session: Session, input: BookingRulesInput): Promise<BookingRules> {
  assertCanWrite(session, "settings.manage");
  const v = bookingRulesSchema.parse(input);
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("workspaces")
    .update({
      auto_confirm_bookings: v.autoConfirm,
      min_notice_minutes: v.minNoticeMinutes,
      max_horizon_days: v.maxHorizonDays,
      slot_interval_minutes: v.slotIntervalMinutes,
      cancellation_deadline_hours: v.cancellationDeadlineHours,
      reschedule_deadline_hours: v.rescheduleDeadlineHours,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.workspaceId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw toRepositoryError(error, "bookingRules.update");
  if (!data) throw new RepositoryNotFoundError("bookingRules.update");
  await audit(
    session,
    "updated",
    "bookingRules",
    session.workspaceId,
    `Booking rules updated: ${v.autoConfirm ? "auto-confirm" : "manual confirmation"}, notice ${v.minNoticeMinutes} min, horizon ${v.maxHorizonDays} d, slots ${v.slotIntervalMinutes} min`,
  );
  return fromRow(data as Row);
}
