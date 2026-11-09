import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => true }));
const sync = vi.hoisted(() => vi.fn());
vi.mock("@/server/billing/subscriptions", () => ({ defaultBillingClient: () => ({}), syncSubscriptionFromEvent: sync }));

import { POST } from "@/app/api/stripe/webhook/route";
import { parseSignedEvent } from "../stripe";

const SECRET = "whsec_test";
const NOW = 1_800_000_000;
const body = JSON.stringify({ type: "customer.subscription.updated", data: { object: { id: "sub_1" } } });
const sign = (payload: string, at: number, secret = SECRET) =>
  `t=${at},v1=${createHmac("sha256", secret).update(`${at}.${payload}`).digest("hex")}`;

describe("parseSignedEvent", () => {
  it("accepts a correctly signed event", () => {
    expect(parseSignedEvent(body, sign(body, NOW), SECRET, NOW)?.type).toBe("customer.subscription.updated");
  });

  it("accepts any v1 value while a secret is being rolled", () => {
    const header = `t=${NOW},v1=${"0".repeat(64)},${sign(body, NOW).split(",")[1]}`;
    expect(parseSignedEvent(body, header, SECRET, NOW)).not.toBeNull();
  });

  it("rejects a missing or malformed header, a wrong secret and a changed body", () => {
    expect(parseSignedEvent(body, null, SECRET, NOW)).toBeNull();
    expect(parseSignedEvent(body, "garbage", SECRET, NOW)).toBeNull();
    expect(parseSignedEvent(body, `t=${NOW},v1=zz`, SECRET, NOW)).toBeNull();
    expect(parseSignedEvent(body, sign(body, NOW, "whsec_other"), SECRET, NOW)).toBeNull();
    expect(parseSignedEvent(`${body} `, sign(body, NOW), SECRET, NOW)).toBeNull();
  });

  it("rejects a replay of an old event", () => {
    expect(parseSignedEvent(body, sign(body, NOW - 301), SECRET, NOW)).toBeNull();
    expect(parseSignedEvent(body, sign(body, NOW - 299), SECRET, NOW)).not.toBeNull();
  });
});

describe("POST /api/stripe/webhook", () => {
  const post = (signature: string | null) =>
    POST(
      new NextRequest("http://localhost/api/stripe/webhook", {
        method: "POST",
        body,
        headers: signature ? { "stripe-signature": signature } : {},
      }),
    );
  const configure = () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("STRIPE_SECRET_KEY", "test-key");
    vi.stubEnv("STRIPE_PRICE_START", "price_s");
    vi.stubEnv("STRIPE_PRICE_BUSINESS", "price_b");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_p");
  };
  const fresh = () => sign(body, Math.floor(Date.now() / 1000));

  afterEach(() => {
    vi.unstubAllEnvs();
    sync.mockReset();
  });

  it("is closed until it is configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect((await post(null)).status).toBe(503);
    expect(sync).not.toHaveBeenCalled();
  });

  it("refuses an unsigned or wrongly signed request and stores nothing", async () => {
    configure();
    expect((await post(null)).status).toBe(400);
    expect((await post(sign(body, Math.floor(Date.now() / 1000), "whsec_other"))).status).toBe(400);
    expect(sync).not.toHaveBeenCalled();
  });

  it("applies a signed event", async () => {
    configure();
    expect((await post(fresh())).status).toBe(200);
    expect(sync).toHaveBeenCalledOnce();
  });

  it("answers 500 on a failure so that Stripe retries, without logging details", async () => {
    configure();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    sync.mockRejectedValueOnce(new Error("save subscription: 42P01"));
    expect((await post(fresh())).status).toBe(500);
    expect(error).toHaveBeenCalledWith("[billing] webhook:", "save subscription: 42P01");
    error.mockRestore();
  });
});
