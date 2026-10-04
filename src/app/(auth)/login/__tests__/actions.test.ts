import { describe, expect, it } from "vitest";

// Plain functions (not vi.fn): a vi.fn that throws is reported as a failure by vitest 4.
class Redirected extends Error {
  constructor(public to: string) {
    super("redirect");
  }
}
let signIn: (email: string, password: string) => Promise<unknown> = async () => ({ ok: false, code: "invalid_credentials" });
let signedOut = false;
let memberships: unknown[] = [];

import { vi } from "vitest";
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock("@/server/auth/supabaseBusinessAuth", () => ({
  getBusinessAuth: () => ({
    signInWithPassword: (e: string, p: string) => signIn(e, p),
    signOut: async () => void (signedOut = true),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => {
      const q = { select: () => q, eq: () => q, order: async () => ({ data: memberships }) };
      return q;
    },
  }),
}));

const { signInOwnerAction } = await import("../actions");

const form = (email: string, password: string) => {
  const f = new FormData();
  f.set("email", email);
  f.set("password", password);
  return f;
};
const run = (email: string, password: string) =>
  signInOwnerAction({}, form(email, password)).then(
    (state) => ({ state, redirectedTo: null as string | null }),
    (e: unknown) => ({ state: null, redirectedTo: e instanceof Redirected ? e.to : "ERROR" }),
  );

describe("sign-in action", () => {
  it("correct credentials -> redirect to the owner's workspace /<slug>/today", async () => {
    signIn = async () => ({ ok: true, userId: "u1" });
    memberships = [
      { role: "staff", workspaces: { slug: "someone-elses" } },
      { role: "owner", workspaces: { slug: "labrity" } },
    ];
    expect((await run("me@example.test", "right-password")).redirectedTo).toBe("/labrity/today");
  });

  it("wrong password -> a visible error CODE, the typed e-mail handed back, and NEVER the password", async () => {
    signIn = async () => ({ ok: false, code: "invalid_credentials" });
    const { state } = await run("  Me@Example.test ", "wrong-password");
    expect(state).toEqual({ error: "invalid_credentials", email: "Me@Example.test" });
    expect(JSON.stringify(state)).not.toContain("wrong-password");
  });

  it("malformed input gets the same generic error (does not reveal which field was wrong) and keeps the e-mail", async () => {
    const { state } = await run("not-an-email", "x");
    expect(state).toEqual({ error: "invalid_credentials", email: "not-an-email" });
  });

  it("a rate-limited or unreachable sign-in surfaces its own code", async () => {
    signIn = async () => ({ ok: false, code: "rate_limited" });
    expect((await run("me@example.test", "pw-123456")).state).toMatchObject({ error: "rate_limited", email: "me@example.test" });
  });

  it("an account with no workspace is signed out again and told so", async () => {
    signIn = async () => ({ ok: true, userId: "u1" });
    memberships = [];
    signedOut = false;
    expect((await run("me@example.test", "right-password")).state).toMatchObject({ error: "no_workspace" });
    expect(signedOut).toBe(true);
  });
});
