"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { demoWorkingHours } from "@/features/workingHours/demoData";
import type { WorkingHoursProfile } from "@/features/workingHours/types";
import { defaultBookingRules, type BookingRules, type TimeOffEntry } from "@/features/scheduling/types";
import { isValidTimeZone, resolveToday } from "@/lib/time/zonedTime";
import { getWorkspaceConfig, isDemoWorkspaceSlug } from "./registry";
import type { WorkspaceConfig } from "./types";

/**
 * What a business screen needs to know about the workspace it is showing —
 * services, staff, resources, working hours, display name. For the four DEMO
 * workspaces it is the built-in preset; for a REAL workspace the server loads
 * it from the database (layout) and hands it down here, so Calendar, Today and
 * Clients never read it from a browser bundle.
 */
export interface WorkspaceCatalogData {
  slug: string;
  name: string;
  timezone: string;
  services: WorkspaceConfig["services"];
  staff: WorkspaceConfig["staff"];
  resources: WorkspaceConfig["resources"];
  workingHours: WorkingHoursProfile[];
  /** Real workspaces: booking rules (min notice, horizon, slot grid, ...). Absent = defaults. */
  bookingRules?: BookingRules;
  /** Time off / closures with private reasons (business side only). */
  timeOff?: TimeOffEntry[];
  /** Archived staff: NOT offered in pickers; only so old appointments keep showing their name. */
  inactiveStaff?: { id: string; name: string }[];
}

const Context = createContext<WorkspaceCatalogData | null>(null);

export function WorkspaceCatalogProvider({ value, children }: { value: WorkspaceCatalogData; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * Config for the current workspace. Real workspace: provider data wrapped into
 * a `WorkspaceConfig` (no demo labels, no demo clients/appointments). Demo:
 * the preset, unchanged.
 */
export function useWorkspaceConfig(workspaceSlug: string): WorkspaceConfig {
  const catalog = useContext(Context);
  return useMemo(() => {
    if (isDemoWorkspaceSlug(workspaceSlug) || !catalog || catalog.slug !== workspaceSlug) {
      return getWorkspaceConfig(workspaceSlug);
    }
    return {
      ...getWorkspaceConfig(workspaceSlug),
      name: catalog.name,
      services: catalog.services,
      staff: catalog.staff,
      resources: catalog.resources,
    };
  }, [catalog, workspaceSlug]);
}

/** IANA zone of a REAL workspace; `null` for demo workspaces (no real zone). */
export function useWorkspaceTimeZone(workspaceSlug: string): string | null {
  const catalog = useContext(Context);
  if (isDemoWorkspaceSlug(workspaceSlug) || !catalog || catalog.slug !== workspaceSlug) return null;
  return isValidTimeZone(catalog.timezone) ? catalog.timezone : null;
}

/**
 * Today's calendar date for the workspace: its own time zone for a real
 * workspace, the browser-local date for demo workspaces (unchanged).
 */
export function useWorkspaceToday(workspaceSlug: string, now: Date = new Date()): string {
  return resolveToday(now, useWorkspaceTimeZone(workspaceSlug));
}

export function useWorkspaceWorkingHours(workspaceSlug: string): WorkingHoursProfile[] {
  const catalog = useContext(Context);
  if (isDemoWorkspaceSlug(workspaceSlug) || !catalog || catalog.slug !== workspaceSlug) return demoWorkingHours;
  return catalog.workingHours;
}

/** Booking rules of the workspace (defaults for demo workspaces / missing data). */
export function useWorkspaceBookingRules(workspaceSlug: string): BookingRules {
  const catalog = useContext(Context);
  if (isDemoWorkspaceSlug(workspaceSlug) || !catalog || catalog.slug !== workspaceSlug) return defaultBookingRules;
  return catalog.bookingRules ?? defaultBookingRules;
}
