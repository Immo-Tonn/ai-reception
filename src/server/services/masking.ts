import type { Appointment, Visibility } from "@/features/appointments/types";
import type { Session } from "@/server/auth/session";
import { can } from "@/server/permissions/roles";

/**
 * The masked shape a caller without access ever sees — no client name,
 * service, price or notes, ever (§8 of the Calendar task, §97 non-
 * negotiable requirement #5/#6). This must be applied server-side, not
 * left to the UI to "just not render" the field — the API response
 * itself never contains the sensitive fields when masked.
 */
export interface MaskedAppointment {
  id: string;
  date: string;
  time: string;
  durationMinutes: number;
  staff: string;
  status: Appointment["status"];
  visibility: Appointment["visibility"];
  masked: true;
}

export type VisibleAppointment = (Appointment & { masked: false }) | MaskedAppointment;

function toMasked(appt: Appointment): MaskedAppointment {
  return {
    id: appt.id,
    date: appt.date,
    time: appt.time,
    durationMinutes: appt.durationMinutes,
    staff: appt.staff,
    status: appt.status,
    visibility: appt.visibility,
    masked: true,
  };
}

/**
 * Whether `session` may see content at this Visibility level — the same
 * check for anything that carries a Visibility field, independent of
 * whatever other axis (e.g. FinancialBucket on Appointment/Invoice) it's
 * combined with. Owner always sees everything; everyone else needs the
 * matching permission — `private_records.view` for PRIVATE/CUSTOM,
 * `owner_records.view` for OWNER_ONLY (§6, reused by Invoice masking in
 * finance.service.ts so both stay in lockstep with this one rule).
 */
export function canSeeVisibility(visibility: Visibility, session: Session): boolean {
  if (session.role === "owner") return true;

  switch (visibility) {
    case "normal":
      return true;
    case "private":
    case "custom":
      return can(session.role, "private_records.view");
    case "ownerOnly":
      return can(session.role, "owner_records.view");
    default:
      return false;
  }
}

/**
 * Applies §6 visibility rules for one appointment against one session.
 */
export function applyVisibility(appt: Appointment, session: Session): VisibleAppointment {
  return canSeeVisibility(appt.visibility, session) ? { ...appt, masked: false } : toMasked(appt);
}

export function applyVisibilityToList(
  appointments: Appointment[],
  session: Session,
): VisibleAppointment[] {
  return appointments.map((appt) => applyVisibility(appt, session));
}
