import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";

vi.mock("server-only", () => ({}));
const { loadPublicCatalog } = await import("../publicBooking.service");

const U = "aaaaaaaa-0000-4000-8000-0000000000a1";
let db: PGlite;
const admin = () => createPgliteSupabaseClient(db, { kind: "service" });

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${U}','o@t.invalid')`);
  await admin().rpc("provision_workspace", { p_user_id: U, p_email: "o@t.invalid", p_full_name: "", p_business_name: "Biz", p_base_slug: "pub-biz", p_locale: "en" });
}, 90_000);
afterAll(async () => db.close());

describe("public booking page profile", () => {
  it("returns only the customer-facing profile; internal fields never reach the page", async () => {
    await db.exec(`update workspaces set description='We cut hair', phone='+49 1', email='hi@pub.example', website='https://pub.example',
      address_line1='Main 1', postal_code='10115', city='Berlin', country='DE', logo_path=id||'/l.png' where slug='pub-biz'`);
    const catalog = await loadPublicCatalog({ admin: admin() }, "pub-biz");
    expect(catalog?.profile).toEqual({
      description: "We cut hair", phone: "+49 1", email: "hi@pub.example", website: "https://pub.example",
      addressLine1: "Main 1", postalCode: "10115", city: "Berlin", country: "DE",
    });
    const json = JSON.stringify(catalog);
    expect(json).not.toMatch(/created_by|default_currency|booking_mode|logo|auto_confirm/);
  });

  it("a workspace with booking switched off is not found, like an unknown slug", async () => {
    await db.exec(`update workspaces set public_booking_enabled=false where slug='pub-biz'`);
    expect(await loadPublicCatalog({ admin: admin() }, "pub-biz")).toBeNull();
    expect(await loadPublicCatalog({ admin: admin() }, "nope-nope")).toBeNull();
  });
});
