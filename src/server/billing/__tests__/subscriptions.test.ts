import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { as, createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";
import type { StripeEvent } from "../stripe";
import { getCurrentSubscription, syncSubscriptionFromEvent } from "../subscriptions";

const OWNER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const config = { secretKey: "test-key", prices: { start: "price_s", business: "price_b", pro: "price_p" } };
const json = (body: unknown) => new Response(JSON.stringify(body));

let db: PGlite;
let client: SupabaseClient;
let workspaceId: string;

const stripeSubscription = (over: Record<string, unknown> = {}) => ({
  id: "sub_1",
  status: "active",
  customer: "cus_1",
  metadata: { workspace_id: workspaceId },
  items: { data: [{ price: { id: "price_b" } }] },
  ...over,
});
const stripeReturning = (subscription: unknown) => vi.fn<typeof fetch>(async () => json(subscription));
const event = (type: string, object: StripeEvent["data"]["object"]): StripeEvent => ({ type, data: { object } });
const stored = async () => (await db.query<{ plan: string; status: string }>("select * from workspace_subscriptions where workspace_id=$1", [workspaceId])).rows[0];

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','a@t.invalid')`);
  workspaceId = await as(db, { kind: "service" }, async () =>
    (await db.query<{ out_workspace_id: string }>("select * from public.provision_workspace($1,$2,'',$3,$4,'en')", [OWNER, "a@t.invalid", "Biz", "billing-biz"])).rows[0].out_workspace_id,
  );
  client = createPgliteSupabaseClient(db, { kind: "service" });
}, 120_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.query("delete from workspace_subscriptions");
});

describe("syncSubscriptionFromEvent", () => {
  it("stores the state read from Stripe after a completed checkout", async () => {
    const fetchImpl = stripeReturning(stripeSubscription());
    await syncSubscriptionFromEvent(event("checkout.session.completed", { id: "cs_1", subscription: "sub_1" }), config, client, fetchImpl);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/v1/subscriptions/sub_1");
    expect(await stored()).toMatchObject({ plan: "business", status: "active", stripe_customer_id: "cus_1" });
  });

  it("trusts Stripe's current state over a stale event", async () => {
    await syncSubscriptionFromEvent(event("customer.subscription.updated", { id: "sub_1" }), config, client, stripeReturning(stripeSubscription({ status: "canceled" })));
    expect((await stored()).status).toBe("canceled");
  });

  it("is safe to repeat", async () => {
    const fetchImpl = stripeReturning(stripeSubscription());
    const updated = event("customer.subscription.updated", { id: "sub_1" });
    await syncSubscriptionFromEvent(updated, config, client, fetchImpl);
    await syncSubscriptionFromEvent(updated, config, client, stripeReturning(stripeSubscription()));
    expect((await db.query("select * from workspace_subscriptions")).rows).toHaveLength(1);
  });

  it("ignores other events, one-off checkouts and subscriptions that aren't ours", async () => {
    const fetchImpl = stripeReturning(stripeSubscription());
    await syncSubscriptionFromEvent(event("invoice.paid", { id: "in_1" }), config, client, fetchImpl);
    await syncSubscriptionFromEvent(event("checkout.session.completed", { id: "cs_1", subscription: null }), config, client, fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    await syncSubscriptionFromEvent(event("customer.subscription.updated", { id: "sub_1" }), config, client, stripeReturning(stripeSubscription({ metadata: {} })));
    await syncSubscriptionFromEvent(event("customer.subscription.updated", { id: "sub_1" }), config, client, stripeReturning(stripeSubscription({ metadata: { workspace_id: "bad" } })));
    expect(await stored()).toBeUndefined();
  });

  it("skips a workspace from another environment on the same Stripe account, without a retry", async () => {
    const elsewhere = stripeSubscription({ metadata: { workspace_id: "cccccccc-0000-4000-8000-000000000000" } });
    await expect(syncSubscriptionFromEvent(event("customer.subscription.updated", { id: "sub_1" }), config, client, stripeReturning(elsewhere))).resolves.toBeUndefined();
  });

  it("fails on a temporary Stripe outage so that Stripe retries", async () => {
    const down = vi.fn<typeof fetch>(async () => new Response("{}", { status: 500 }));
    await expect(syncSubscriptionFromEvent(event("customer.subscription.updated", { id: "sub_1" }), config, client, down)).rejects.toThrow();
  });
});

describe("getCurrentSubscription", () => {
  const fromStripe = (data: unknown[]) => vi.fn<typeof fetch>(async () => json({ data }));

  it("answers from the stored row without asking Stripe", async () => {
    await syncSubscriptionFromEvent(event("customer.subscription.updated", { id: "sub_1" }), config, client, stripeReturning(stripeSubscription()));
    const fetchImpl = fromStripe([]);
    await expect(getCurrentSubscription(config, workspaceId, () => client, fetchImpl)).resolves.toEqual({ subscriptionId: "sub_1", customerId: "cus_1", planId: "business" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks Stripe while the webhook hasn't arrived yet", async () => {
    await expect(getCurrentSubscription(config, workspaceId, () => client, fromStripe([stripeSubscription()]))).resolves.toEqual({ subscriptionId: "sub_1", customerId: "cus_1", planId: "business" });
  });

  it("asks Stripe when the stored subscription has ended, and allows a new purchase", async () => {
    await syncSubscriptionFromEvent(event("customer.subscription.deleted", { id: "sub_1" }), config, client, stripeReturning(stripeSubscription({ status: "canceled" })));
    await expect(getCurrentSubscription(config, workspaceId, () => client, fromStripe([]))).resolves.toBeNull();
  });

  it("still blocks a double charge when the database is unavailable or the migration isn't applied", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const noClient = () => {
      throw new Error("not configured");
    };
    await expect(getCurrentSubscription(config, workspaceId, noClient, fromStripe([stripeSubscription()]))).resolves.toEqual({ subscriptionId: "sub_1", customerId: "cus_1", planId: "business" });
    error.mockRestore();
  });
});
