import type { ReactElement, ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";
import { holder, makeTeamWorld, type TeamWorld, type Tenant } from "./teamStagingWorld";

/**
 * Team staging, part 5: the business WORKSPACE SWITCHER. A business user can belong to several workspaces
 * (a `workspace_members` row each); the switcher must list exactly those, never another business (not even a
 * discoverable one), and the app layout must answer 404 for a slug that is not one of the user's memberships.
 * The layout itself runs here (async server component) with only its visual children stubbed.
 */
vi.mock("@/lib/supabase/server", async () => ({ createSupabaseServerClient: async () => (await import("./teamStagingWorld")).holder.user }));
vi.mock("@/lib/supabase/admin", async () => ({ createSupabaseAdminClient: () => ({ rpc: async (n: string, a: Record<string, unknown>) => (await import("./teamStagingWorld")).holder.admin!.rpc(n, a) }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/i18n/next", () => ({ getRequestLocale: async () => "en" }));
vi.mock("@/components/layout/Sidebar/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("@/components/layout/BottomNav/BottomNav", () => ({ BottomNav: () => null }));
vi.mock("@/components/layout/Preferences/Preferences", () => ({ Preferences: () => null }));
vi.mock("@/components/layout/WorkspaceSwitcher/WorkspaceSwitcher", () => ({ WorkspaceSwitcher: function WorkspaceSwitcher() { return null; } }));
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";

const { listMyWorkspaces } = await import("@/server/services/myWorkspaces.service");
const { default: WorkspaceLayout } = await import("@/app/(app)/[workspaceSlug]/layout");
const { WorkspaceSwitcher } = await import("@/components/layout/WorkspaceSwitcher/WorkspaceSwitcher");
const profileSvc = await import("@/server/services/businessProfile.service");

let db: PGlite;
let tw: TeamWorld;
let A: Tenant, B: Tenant, C: Tenant;
let both: string; // member of A and C
let nobody: string; // signed in, no membership at all

const asUser = (id: string) => (holder.user = createPgliteSupabaseClient(db, { kind: "user", id }));
const mine = async (id: string) => (asUser(id), listMyWorkspaces());

/** Runs the real layout for `slug` as `user` and returns what it handed the switcher (or how it refused). */
async function layoutFor(user: string | null, slug: string): Promise<{ workspaces: { slug: string; name: string }[] | undefined } | { refused: string }> {
  holder.user = user ? createPgliteSupabaseClient(db, { kind: "user", id: user }) : createPgliteSupabaseClient(db, { kind: "anon" });
  let tree: ReactNode;
  try {
    tree = await WorkspaceLayout({ children: null, params: Promise.resolve({ workspaceSlug: slug }) });
  } catch (e) {
    return { refused: (e as Error).message };
  }
  const found: ReactElement[] = [];
  const walk = (n: ReactNode) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const el = n as ReactElement<{ children?: ReactNode }>;
    if (el.type === WorkspaceSwitcher) found.push(el);
    walk(el.props?.children);
  };
  walk(tree);
  expect(found).toHaveLength(1);
  return { workspaces: (found[0].props as { workspaces?: { slug: string; name: string }[] }).workspaces };
}

beforeAll(async () => {
  db = await createMigratedDb();
  tw = makeTeamWorld(db);
  A = await tw.signUp("Anna's Salon", "a@t.invalid");
  B = await tw.signUp("Berta's Garage", "b@t.invalid");
  C = await tw.signUp("Carl's Studio", "c@t.invalid");
  // B lists itself in the public directory: that must NOT make it show up in anybody's switcher.
  const sb = await tw.session(B.userId, B.slug);
  await profileSvc.updateBusinessProfile(sb, { ...(await profileSvc.getBusinessProfile(sb)), publicBookingEnabled: true, discoverable: true });
  // One person works for two businesses: the same user is also a member of A and of C.
  both = await tw.user("both");
  await tw.q("insert into workspace_members (workspace_id, profile_id, role) values ($1,$2,'manager'),($3,$2,'staff')", [A.ws, both, C.ws]);
  nobody = await tw.user("nobody");
}, 120_000);
afterAll(async () => db.close());

describe("listMyWorkspaces: only the user's own memberships", () => {
  it("a user in A and C sees exactly A and C (name + slug), sorted, and never B even though B is discoverable", async () => {
    expect(await mine(both)).toEqual([
      { slug: A.slug, name: "Anna's Salon" },
      { slug: C.slug, name: "Carl's Studio" },
    ]);
    expect((await tw.q<{ discoverable: boolean }>("select discoverable from workspaces where id = $1", [B.ws]))[0].discoverable).toBe(true);
  });

  it("owners see only their own business; a user with no membership sees none; nobody signed in sees none", async () => {
    expect(await mine(A.userId)).toEqual([{ slug: A.slug, name: "Anna's Salon" }]);
    expect(await mine(B.userId)).toEqual([{ slug: B.slug, name: "Berta's Garage" }]);
    expect(await mine(C.userId)).toEqual([{ slug: C.slug, name: "Carl's Studio" }]);
    expect(await mine(nobody)).toEqual([]);
    holder.user = createPgliteSupabaseClient(db, { kind: "anon" });
    expect(await listMyWorkspaces()).toEqual([]);
  });

  it("the list carries no internal fields", async () => {
    const list = await mine(both);
    for (const w of list) expect(Object.keys(w).sort()).toEqual(["name", "slug"]);
  });

  it("a removed membership disappears from the list at once; a rename shows up, the slug stays", async () => {
    await tw.q("delete from workspace_members where workspace_id = $1 and profile_id = $2", [C.ws, both]);
    expect((await mine(both)).map((w) => w.slug)).toEqual([A.slug]);
    await tw.q("insert into workspace_members (workspace_id, profile_id, role) values ($1,$2,'staff')", [C.ws, both]);
    const sc = await tw.session(C.userId, C.slug);
    await profileSvc.updateBusinessProfile(sc, { ...(await profileSvc.getBusinessProfile(sc)), name: "Carl & Co" });
    expect(await mine(both)).toEqual([{ slug: A.slug, name: "Anna's Salon" }, { slug: C.slug, name: "Carl & Co" }]);
  });

  it("a database failure degrades to an empty list instead of breaking the page", async () => {
    holder.user = { auth: { getUser: async () => ({ data: { user: { id: both } }, error: null }) }, from: () => { throw new Error("db down"); } } as never;
    expect(await listMyWorkspaces()).toEqual([]);
  });
});

describe("the app layout (switcher wiring and the 404 gate)", () => {
  it("a member of A and C gets exactly A and C handed to the switcher, in either workspace", async () => {
    const expected = [{ slug: A.slug, name: "Anna's Salon" }, { slug: C.slug, name: "Carl & Co" }];
    expect(await layoutFor(both, A.slug)).toEqual({ workspaces: expected });
    expect(await layoutFor(both, C.slug)).toEqual({ workspaces: expected });
  });

  it("switching to a workspace the user is not a member of is a 404 (B exists and is discoverable; an unknown slug looks the same)", async () => {
    expect(await layoutFor(both, B.slug)).toEqual({ refused: "NEXT_NOT_FOUND" });
    expect(await layoutFor(both, "no-such-business")).toEqual({ refused: "NEXT_NOT_FOUND" });
    expect(await layoutFor(A.userId, C.slug)).toEqual({ refused: "NEXT_NOT_FOUND" });
    expect(await layoutFor(nobody, A.slug)).toEqual({ refused: "NEXT_NOT_FOUND" });
  });

  it("not signed in -> /login; a single-workspace owner gets just their own workspace", async () => {
    expect(await layoutFor(null, A.slug)).toEqual({ refused: "NEXT_REDIRECT:/login" });
    expect(await layoutFor(B.userId, B.slug)).toEqual({ workspaces: [{ slug: B.slug, name: "Berta's Garage" }] });
  });

  it("demo workspaces keep their own behaviour: no real workspace list is attached", async () => {
    const r = await layoutFor(both, "demo-salon");
    expect(r).toEqual({ workspaces: [] });
  });
});
