import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createCheckoutUrl, createPortalUrl, findWorkspaceSubscription, getStripeConfig, StripeRequestError } from "../stripe";

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

const config = { secretKey: "test-key", prices: { start: "price_s", business: "price_b", pro: "price_p" } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const sub = (status: string, price = "price_b") => ({ status, customer: "cus_1", items: { data: [{ price: { id: price } }] } });

describe("getStripeConfig", () => {
  const full = { STRIPE_SECRET_KEY: "k", STRIPE_PRICE_START: "a", STRIPE_PRICE_BUSINESS: "b", STRIPE_PRICE_PRO: "c" };

  it("needs the key and all three prices", () => {
    expect(getStripeConfig(full)?.prices).toEqual({ start: "a", business: "b", pro: "c" });
    expect(getStripeConfig({ ...full, STRIPE_PRICE_PRO: " " })).toBeNull();
    expect(getStripeConfig({})).toBeNull();
  });
});

describe("findWorkspaceSubscription", () => {
  it("searches by workspace metadata and maps the price to our plan", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => json({ data: [sub("canceled", "price_s"), sub("active")] }));
    await expect(findWorkspaceSubscription(config, "w1", fetchImpl)).resolves.toEqual({ customerId: "cus_1", planId: "business" });
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe("/v1/subscriptions/search");
    expect(url.searchParams.get("query")).toBe("metadata['workspace_id']:'w1'");
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("treats a past-due subscription as occupying, canceled and incomplete as free", async () => {
    await expect(findWorkspaceSubscription(config, "w1", async () => json({ data: [sub("past_due")] }))).resolves.not.toBeNull();
    await expect(findWorkspaceSubscription(config, "w1", async () => json({ data: [sub("canceled"), sub("incomplete")] }))).resolves.toBeNull();
  });

  it("keeps a subscription on an unknown price, without naming a plan", async () => {
    await expect(findWorkspaceSubscription(config, "w1", async () => json({ data: [sub("active", "price_other")] }))).resolves.toEqual({
      customerId: "cus_1",
      planId: null,
    });
  });

  it("escapes quotes so a value cannot change the search query", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => json({ data: [] }));
    await findWorkspaceSubscription(config, "a'b", fetchImpl);
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get("query")).toBe("metadata['workspace_id']:'a\\'b'");
  });
});

describe("createCheckoutUrl", () => {
  it("creates a subscription session for the plan's price, tagged with the workspace", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => json({ url: "https://checkout.stripe.com/c/1" }));
    const url = await createCheckoutUrl(config, { planId: "pro", workspaceId: "w1", successUrl: "https://a/ok", cancelUrl: "https://a/no" }, fetchImpl);
    expect(url).toBe("https://checkout.stripe.com/c/1");
    expect(fetchImpl.mock.calls[0][1]?.method).toBe("POST");
    const body = new URLSearchParams(fetchImpl.mock.calls[0][1]?.body as string);
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("line_items[0][price]")).toBe("price_p");
    expect(body.get("subscription_data[metadata][workspace_id]")).toBe("w1");
    expect(body.get("success_url")).toBe("https://a/ok");
  });

  it("reports Stripe's error code without the key", async () => {
    const failing = async () => json({ error: { type: "invalid_request_error", code: "resource_missing" } }, 400);
    const error = await createCheckoutUrl(config, { planId: "start", workspaceId: "w1", successUrl: "s", cancelUrl: "c" }, failing).catch((e) => e);
    expect(error).toBeInstanceOf(StripeRequestError);
    expect(error.message).toContain("resource_missing");
    expect(error.message).not.toContain("test-key");
  });

  it("reports a network failure as an error", async () => {
    const offline = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(createCheckoutUrl(config, { planId: "start", workspaceId: "w1", successUrl: "s", cancelUrl: "c" }, offline)).rejects.toBeInstanceOf(StripeRequestError);
  });
});

describe("createPortalUrl", () => {
  it("opens the portal for the customer", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => json({ url: "https://billing.stripe.com/p/1" }));
    await expect(createPortalUrl(config, { customerId: "cus_1", returnUrl: "https://a/back" }, fetchImpl)).resolves.toBe("https://billing.stripe.com/p/1");
    expect(new URLSearchParams(fetchImpl.mock.calls[0][1]?.body as string).get("customer")).toBe("cus_1");
  });
});
