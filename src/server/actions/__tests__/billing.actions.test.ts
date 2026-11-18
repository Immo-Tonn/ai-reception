import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class Redirect extends Error {
  constructor(public url: string) {
    super("redirect");
  }
}
const getSession = vi.fn();
const getCurrentSubscription = vi.fn();
const getWorkspaceCustomerId = vi.fn();
const createCheckoutUrl = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirect(url); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "app.example" }) }));
vi.mock("@/server/auth/session", () => ({ getSession: (...a: unknown[]) => getSession(...a) }));
vi.mock("@/server/billing/subscriptions", () => ({
  getCurrentSubscription: (...a: unknown[]) => getCurrentSubscription(...a),
  getWorkspaceCustomerId: (...a: unknown[]) => getWorkspaceCustomerId(...a),
}));
vi.mock("@/server/billing/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/billing/stripe")>()),
  createCheckoutUrl: (...a: unknown[]) => createCheckoutUrl(...a),
}));

const { cancelSubscriptionAction, openBillingPortalAction, resumeSubscriptionAction, startCheckoutAction } = await import("../billing.actions");
const { StripeRequestError } = await import("@/server/billing/stripe");

const redirectOf = async (run: () => Promise<void>) => {
  try {
    await run();
    return "no redirect";
  } catch (e) {
    if (e instanceof Redirect) return e.url;
    throw e;
  }
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example");
  vi.stubEnv("STRIPE_SECRET_KEY", "test-key");
  vi.stubEnv("STRIPE_PRICE_START", "price_s");
  vi.stubEnv("STRIPE_PRICE_BUSINESS", "price_b");
  vi.stubEnv("STRIPE_PRICE_PRO", "price_p");
  getSession.mockResolvedValue({ userId: "u1", workspaceId: "w1", role: "owner" });
  getCurrentSubscription.mockResolvedValue(null);
  getWorkspaceCustomerId.mockResolvedValue("cus_1");
  createCheckoutUrl.mockResolvedValue("https://checkout.stripe.com/c/1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("billing actions: workspace slug", () => {
  const actions = [
    (slug: string) => startCheckoutAction(slug, "pro"),
    (slug: string) => openBillingPortalAction(slug),
    (slug: string) => cancelSubscriptionAction(slug),
    (slug: string) => resumeSubscriptionAction(slug),
  ];

  it.each(["/evil.example", "evil.example/x", "Biz", "biz/../x", "", "a".repeat(61)])(
    "never builds a redirect from an invalid slug %j",
    async (slug) => {
      for (const action of actions) expect(await redirectOf(() => action(slug))).toBe("/");
      expect(getSession).not.toHaveBeenCalled();
    },
  );
});

describe("startCheckoutAction", () => {
  it("sends the owner to Stripe with the workspace's one customer", async () => {
    expect(await redirectOf(() => startCheckoutAction("biz", "pro"))).toBe("https://checkout.stripe.com/c/1");
    expect(createCheckoutUrl.mock.calls[0][1]).toMatchObject({
      planId: "pro",
      workspaceId: "w1",
      customerId: "cus_1",
      successUrl: "https://app.example/biz/settings/billing?status=success",
    });
  });

  it("shows the current plan instead of a second checkout", async () => {
    getCurrentSubscription.mockResolvedValue({ subscriptionId: "sub_1", customerId: "cus_1", planId: "start" });
    expect(await redirectOf(() => startCheckoutAction("biz", "pro"))).toBe("/biz/settings/billing");
    expect(createCheckoutUrl).not.toHaveBeenCalled();
  });

  it("returns to the page with an error and logs only a code", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    createCheckoutUrl.mockRejectedValue(new StripeRequestError(400, "resource_missing"));
    expect(await redirectOf(() => startCheckoutAction("biz", "pro"))).toBe("/biz/settings/billing?status=error");
    expect(error).toHaveBeenCalledWith("[billing]", "stripe_400_resource_missing");
    error.mockRestore();
  });
});
