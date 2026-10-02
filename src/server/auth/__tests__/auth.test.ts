import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapSupabaseAuthError } from "../supabaseBusinessAuth";
import { signUpSchema, signInSchema } from "@/server/validation/auth.schema";
import type { BusinessAuthProvider } from "../businessAuth";

// Plain function holder (not vi.fn): vitest 4 reports a vi.fn that threw as a test failure even when
// the code under test caught it, and the exception path is exactly what one test here needs.
const calls: [string, Record<string, unknown>][] = [];
let rpcImpl: (name: string, args: Record<string, unknown>) => Promise<unknown> = async () => ({ data: null, error: null });
const rpc = {
  mock: { calls },
  mockReset() { calls.length = 0; rpcImpl = async () => ({ data: null, error: null }); },
  mockResolvedValue(v: unknown) { rpcImpl = async () => v; },
  mockRejected(e: Error) { rpcImpl = async () => { throw e; }; },
  call(name: string, args: Record<string, unknown>) { calls.push([name, args]); return rpcImpl(name, args); },
  get callCount() { return calls.length; },
};
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: (n: string, a: Record<string, unknown>) => rpc.call(n, a) }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));

const { signUpOwner } = await import("@/server/services/provisioning.service");

function fakeAuth(overrides: Partial<BusinessAuthProvider> = {}): BusinessAuthProvider & { discarded: string[] } {
  const discarded: string[] = [];
  return {
    discarded,
    signUpWithPassword: vi.fn(async () => ({ ok: true as const, userId: "u1", hasSession: true })),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    getCurrentUserId: vi.fn(),
    discardUser: vi.fn(async (id: string) => void discarded.push(id)),
    ...overrides,
  };
}

const valid = { businessName: "Anna's Studio", email: "Anna@Example.COM ", password: "correct-horse" };

describe("Supabase Auth error mapping (raw provider messages are dropped)", () => {
  it.each([
    [{ code: "invalid_credentials" }, "invalid_credentials"],
    [{ code: "user_already_exists" }, "email_taken"],
    [{ code: "email_exists" }, "email_taken"],
    [{ code: "weak_password" }, "weak_password"],
    [{ code: "over_request_rate_limit" }, "rate_limited"],
    [{ status: 429 }, "rate_limited"],
    [{ code: "validation_failed" }, "invalid_input"],
    [{ code: "something_new" }, "unknown"],
    [null, "unknown"],
  ])("%j -> %s", (error, expected) => {
    expect(mapSupabaseAuthError(error as never)).toBe(expected);
  });
});

describe("auth input validation", () => {
  it("normalizes e-mail, enforces 8–72 char passwords", () => {
    expect(signUpSchema.parse(valid).email).toBe("anna@example.com");
    expect(signUpSchema.safeParse({ ...valid, password: "short" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, password: "x".repeat(73) }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, businessName: "  " }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, email: "nope" }).success).toBe(false);
    expect(signInSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});

describe("signUpOwner — Auth user + atomic provisioning", () => {
  beforeEach(() => rpc.mockReset());

  it("creates the user, provisions once via the RPC and returns the allocated slug", async () => {
    rpc.mockResolvedValue({ data: [{ out_workspace_id: "w1", out_slug: "annas-studio", out_created: true }], error: null });
    const auth = fakeAuth();
    const result = await signUpOwner(auth, valid, "de");
    expect(result).toEqual({ ok: true, outcome: "signed_in", workspaceSlug: "annas-studio" });
    expect(rpc.callCount).toBe(1);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("provision_workspace");
    expect(args).toMatchObject({ p_user_id: "u1", p_email: "anna@example.com", p_business_name: "Anna's Studio", p_base_slug: "anna-s-studio", p_locale: "de" });
    expect(auth.discarded).toEqual([]);
  });

  it("if provisioning fails the new Auth user is deleted again — no half-made account", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "db exploded: relation x does not exist" } });
    const auth = fakeAuth();
    const result = await signUpOwner(auth, valid, "en");
    expect(result).toEqual({ ok: false, code: "unknown" });
    expect(auth.discarded).toEqual(["u1"]);
    expect(JSON.stringify(result)).not.toContain("exploded"); // raw DB text never escapes
  });

  it("an exception during provisioning also rolls back", async () => {
    // A rejecting thenable (what a dropped connection looks like), not a throwing mock.
    rpc.mockRejected(new Error("network"));
    const auth = fakeAuth();
    expect(await signUpOwner(auth, valid, "en")).toEqual({ ok: false, code: "unknown" });
    expect(auth.discarded).toEqual(["u1"]);
  });

  it("a stale profile owning the e-mail gets the same neutral answer as any other taken address", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "profile_email_conflict" } });
    const auth = fakeAuth();
    expect(await signUpOwner(auth, valid, "en")).toEqual({ ok: true, outcome: "check_email" });
    expect(auth.discarded).toEqual(["u1"]);
  });

  it("e-mail confirmation ON: a new account is provisioned but the answer is the neutral 'check your e-mail'", async () => {
    rpc.mockResolvedValue({ data: [{ out_workspace_id: "w1", out_slug: "x-salon", out_created: true }], error: null });
    const auth = fakeAuth({ signUpWithPassword: vi.fn(async () => ({ ok: true as const, userId: "u2", hasSession: false })) });
    expect(await signUpOwner(auth, valid, "en")).toEqual({ ok: true, outcome: "check_email" });
    expect(rpc.callCount).toBe(1);
  });

  it("invalid input never reaches Auth or the database", async () => {
    const auth = fakeAuth();
    expect(await signUpOwner(auth, { ...valid, password: "short" }, "en")).toEqual({ ok: false, code: "weak_password" });
    expect(await signUpOwner(auth, { ...valid, email: "bad" }, "en")).toEqual({ ok: false, code: "invalid_input" });
    expect(auth.signUpWithPassword).not.toHaveBeenCalled();
    expect(rpc.callCount).toBe(0);
  });

  it("NO USER ENUMERATION: an already-registered e-mail yields exactly the same answer as a new one, and provisions nothing", async () => {
    const taken = fakeAuth({ signUpWithPassword: vi.fn(async () => ({ ok: false as const, code: "email_taken" as const })) });
    const fresh = fakeAuth({ signUpWithPassword: vi.fn(async () => ({ ok: true as const, userId: "u9", hasSession: false })) });
    rpc.mockResolvedValue({ data: [{ out_workspace_id: "w", out_slug: "s-salon", out_created: true }], error: null });
    expect(await signUpOwner(taken, valid, "en")).toEqual(await signUpOwner(fresh, valid, "en"));
    expect(taken.discarded).toEqual([]);
  });

  it("other Auth failures still surface as codes", async () => {
    const auth = fakeAuth({ signUpWithPassword: vi.fn(async () => ({ ok: false as const, code: "rate_limited" as const })) });
    expect(await signUpOwner(auth, valid, "en")).toEqual({ ok: false, code: "rate_limited" });
    expect(rpc.callCount).toBe(0);
  });
});
