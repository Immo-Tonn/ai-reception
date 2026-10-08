import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServerAuditLogRepository } from "@/server/repository/registry";
import { RepositoryNotFoundError } from "@/server/repository/errors";
import {
  updateBusinessProfileSchema,
  type BusinessProfileData,
  type UpdateBusinessProfileInput,
} from "@/server/validation/businessProfile.schema";

export type BusinessProfile = BusinessProfileData;

const COLUMNS =
  "name,industry,description,phone,email,website,address_line1,postal_code,city,country,timezone,default_currency,public_booking_enabled,discoverable";

type Row = Record<string, unknown>;

function fromRow(row: Row): BusinessProfile {
  return {
    name: row.name as string,
    industry: (row.industry as string | null) ?? "other",
    description: (row.description as string) ?? "",
    phone: (row.phone as string) ?? "",
    email: (row.email as string) ?? "",
    website: (row.website as string) ?? "",
    addressLine1: (row.address_line1 as string) ?? "",
    postalCode: (row.postal_code as string) ?? "",
    city: (row.city as string) ?? "",
    country: (row.country as string) ?? "",
    timezone: row.timezone as string,
    currency: row.default_currency as BusinessProfile["currency"],
    publicBookingEnabled: row.public_booking_enabled === true,
    discoverable: row.discoverable === true,
  };
}

export async function getBusinessProfile(session: Session): Promise<BusinessProfile> {
  assertCan(session.role, "settings.manage");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("workspaces").select(COLUMNS).eq("id", session.workspaceId).maybeSingle();
  if (error || !data) throw new RepositoryNotFoundError("workspaces");
  return fromRow(data as Row);
}

/** Never touches the slug (public URL); RLS + the 0008 trigger enforce that again in the database. */
export async function updateBusinessProfile(session: Session, input: UpdateBusinessProfileInput): Promise<BusinessProfile> {
  assertCan(session.role, "settings.manage");
  const data = updateBusinessProfileSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("workspaces")
    .update({
      name: data.name,
      industry: data.industry,
      description: data.description,
      phone: data.phone,
      email: data.email,
      website: data.website,
      address_line1: data.addressLine1,
      postal_code: data.postalCode,
      city: data.city,
      country: data.country,
      timezone: data.timezone,
      default_currency: data.currency,
      public_booking_enabled: data.publicBookingEnabled,
      discoverable: data.discoverable,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.workspaceId)
    .select(COLUMNS)
    .maybeSingle();
  if (error || !row) throw new RepositoryNotFoundError("workspaces");
  await getServerAuditLogRepository(session.workspaceId).create({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action: "updated",
    entityType: "workspace",
    entityId: session.workspaceId,
    summary: "Business profile updated",
    source: "user",
  });
  return fromRow(row as Row);
}
