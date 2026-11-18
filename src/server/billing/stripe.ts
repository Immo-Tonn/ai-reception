import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { BillingPlanId } from "@/features/billing/plans";

/**
 * Stripe adapter (hosted Checkout + Customer Portal + webhook signatures):
 * plain `fetch`, no SDK dependency. A subscription carries
 * `metadata.workspace_id`, which ties it to the workspace.
 */
const API_BASE = "https://api.stripe.com/v1";
/**
 * Pinned so a change of the account's default API version can't change the
 * shapes read here. Webhook payloads don't depend on it: the webhook only
 * takes the subscription id from an event and re-reads it with this version.
 */
export const STRIPE_API_VERSION = "2025-03-31.basil";
const REQUEST_TIMEOUT_MS = 10_000;
/** A repeated "choose plan" within this window gets the same Checkout page instead of a second one. */
const CHECKOUT_IDEMPOTENCY_WINDOW_MS = 60 * 60 * 1000;
/** Stripe's default: a signed event older than this is treated as a replay. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

/** A subscription in these states still occupies the workspace: never sell a second one. */
const OCCUPYING_STATUSES = new Set(["active", "trialing", "past_due", "unpaid"]);

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface StripeConfig {
  secretKey: string;
  prices: Record<BillingPlanId, string>;
}

export interface WorkspaceSubscription {
  subscriptionId: string;
  customerId: string;
  /** `null`: active, but on a price that is not one of our three plans. */
  planId: BillingPlanId | null;
}

/** A billing failure with a short `code` that is safe to log (no ids, e-mail addresses or keys). */
export class BillingError extends Error {
  constructor(readonly code: string) {
    super(`billing failed: ${code}`);
    this.name = "BillingError";
  }
}

/** Carries only Stripe's status and error type/code — never the key or the request body. */
export class StripeRequestError extends BillingError {
  constructor(status: number | "network", stripeCode?: string) {
    super(`stripe_${status}${stripeCode ? `_${stripeCode}` : ""}`);
    this.name = "StripeRequestError";
  }
}

/** The loggable code of any error: a `BillingError`'s code, otherwise just "unknown" (never the message). */
export function billingErrorCode(error: unknown): string {
  return error instanceof BillingError && /^[A-Za-z0-9_]+$/.test(error.code) ? error.code : "unknown";
}

/** `null` unless the secret key and all three prices are set. */
export function getStripeConfig(env: Record<string, string | undefined> = process.env): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const start = env.STRIPE_PRICE_START?.trim();
  const business = env.STRIPE_PRICE_BUSINESS?.trim();
  const pro = env.STRIPE_PRICE_PRO?.trim();
  if (!secretKey || !start || !business || !pro) return null;
  return { secretKey, prices: { start, business, pro } };
}

async function stripeRequest<T>(
  config: StripeConfig,
  path: string,
  params: Record<string, string>,
  method: "GET" | "POST",
  fetchImpl: FetchLike,
  idempotencyKey?: string,
): Promise<T> {
  const query = new URLSearchParams(params).toString();
  let response: Response;
  try {
    response = await fetchImpl(method === "GET" ? `${API_BASE}${path}?${query}` : `${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        "Stripe-Version": STRIPE_API_VERSION,
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(method === "POST" ? { body: query } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new StripeRequestError("network");
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: { type?: string; code?: string } }) | null;
  if (!response.ok || !body) {
    throw new StripeRequestError(response.status, body?.error?.code ?? body?.error?.type);
  }
  return body;
}

const searchValue = (value: string) => value.replace(/[\\']/g, "\\$&");

/** The workspace's current subscription, if any. Search is eventually consistent (up to about a minute). */
export async function findWorkspaceSubscription(
  config: StripeConfig,
  workspaceId: string,
  fetchImpl: FetchLike = fetch,
): Promise<WorkspaceSubscription | null> {
  const { data } = await stripeRequest<{
    data: { id: string; status: string; customer: string; items: { data: { price: { id: string } }[] } }[];
  }>(
    config,
    "/subscriptions/search",
    { query: `metadata['workspace_id']:'${searchValue(workspaceId)}'`, limit: "100" },
    "GET",
    fetchImpl,
  );
  const current = data.find((subscription) => OCCUPYING_STATUSES.has(subscription.status));
  if (!current) return null;
  return { subscriptionId: current.id, customerId: current.customer, planId: planOfPrice(config, current.items.data[0]?.price.id) };
}

function planOfPrice(config: StripeConfig, priceId: string | undefined): BillingPlanId | null {
  return (Object.keys(config.prices) as BillingPlanId[]).find((id) => config.prices[id] === priceId) ?? null;
}

export function isOccupyingStatus(status: string): boolean {
  return OCCUPYING_STATUSES.has(status);
}

export interface StripeSubscriptionState extends WorkspaceSubscription {
  status: string;
  /** Cancellation is scheduled: the subscription ends at the close of the paid period. */
  cancelScheduled: boolean;
  /** Unix seconds when it ends, if Stripe reports it. */
  cancelAt: number | null;
  /** `null`: not one of ours (no workspace in its metadata). */
  workspaceId: string | null;
}

/** The subscription as Stripe has it right now. */
export async function fetchSubscription(
  config: StripeConfig,
  subscriptionId: string,
  fetchImpl: FetchLike = fetch,
): Promise<StripeSubscriptionState> {
  const subscription = await stripeRequest<{
    id: string;
    status: string;
    customer: string;
    metadata?: { workspace_id?: string };
    cancel_at_period_end?: boolean;
    cancel_at?: number | null;
    current_period_end?: number;
    items: { data: { price: { id: string }; current_period_end?: number }[] };
  }>(config, `/subscriptions/${encodeURIComponent(subscriptionId)}`, {}, "GET", fetchImpl);
  const cancelScheduled = Boolean(subscription.cancel_at_period_end || subscription.cancel_at);
  // Stripe moved the period end from the subscription to its items in newer API versions.
  const periodEnd = subscription.current_period_end ?? subscription.items.data[0]?.current_period_end ?? null;
  return {
    subscriptionId: subscription.id,
    status: subscription.status,
    customerId: subscription.customer,
    workspaceId: subscription.metadata?.workspace_id ?? null,
    cancelScheduled,
    cancelAt: cancelScheduled ? (subscription.cancel_at ?? periodEnd) : null,
    planId: planOfPrice(config, subscription.items.data[0]?.price.id),
  };
}

/** Schedules the end of the subscription at the close of the paid period, or takes that back. */
export async function setCancelAtPeriodEnd(
  config: StripeConfig,
  subscriptionId: string,
  cancel: boolean,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await stripeRequest(config, `/subscriptions/${encodeURIComponent(subscriptionId)}`, { cancel_at_period_end: String(cancel) }, "POST", fetchImpl);
}

export interface StripeEvent {
  type: string;
  data: { object: { id?: string; subscription?: string | null } };
}

/**
 * The event, if `Stripe-Signature` proves it came from Stripe (HMAC-SHA256 of
 * `<timestamp>.<raw body>` with the endpoint's signing secret), else `null`.
 */
export function parseSignedEvent(rawBody: string, signatureHeader: string | null, secret: string, nowSeconds = Date.now() / 1000): StripeEvent | null {
  if (!signatureHeader) return null;
  const parts = signatureHeader.split(",").map((part) => part.trim().split("=") as [string, string]);
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return null;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  // Stripe may send several v1 values while a signing secret is being rolled.
  const valid = parts.some(([key, value]) => {
    if (key !== "v1" || !value) return false;
    const given = Buffer.from(value, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!valid) return null;

  try {
    return JSON.parse(rawBody) as StripeEvent;
  } catch {
    return null;
  }
}

/**
 * The workspace's one Stripe customer: found by `metadata.workspace_id`, or
 * created. Search lags by up to a minute, so creation carries an idempotency
 * key: two concurrent first purchases still get the same customer.
 */
export async function findOrCreateCustomer(config: StripeConfig, workspaceId: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const { data } = await stripeRequest<{ data: { id: string }[] }>(
    config,
    "/customers/search",
    { query: `metadata['workspace_id']:'${searchValue(workspaceId)}'`, limit: "1" },
    "GET",
    fetchImpl,
  );
  if (data[0]) return data[0].id;
  const { id } = await stripeRequest<{ id: string }>(
    config,
    "/customers",
    { "metadata[workspace_id]": workspaceId },
    "POST",
    fetchImpl,
    `customer-${workspaceId}`,
  );
  return id;
}

/**
 * URL of the Stripe-hosted payment page for one plan. The idempotency key
 * makes a double click (or two tabs) within the window return the same page,
 * so only one subscription can be paid for.
 */
export async function createCheckoutUrl(
  config: StripeConfig,
  input: { planId: BillingPlanId; workspaceId: string; customerId: string; successUrl: string; cancelUrl: string },
  fetchImpl: FetchLike = fetch,
  now = Date.now(),
): Promise<string> {
  const params = {
    mode: "subscription",
    customer: input.customerId,
    "line_items[0][price]": config.prices[input.planId],
    "line_items[0][quantity]": "1",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.workspaceId,
    "metadata[workspace_id]": input.workspaceId,
    "subscription_data[metadata][workspace_id]": input.workspaceId,
  };
  // Stripe rejects a reused key with different parameters, so the key covers them all.
  const slot = Math.floor(now / CHECKOUT_IDEMPOTENCY_WINDOW_MS);
  const digest = createHash("sha256").update(JSON.stringify([params, slot])).digest("hex").slice(0, 32);
  const { url } = await stripeRequest<{ url: string }>(config, "/checkout/sessions", params, "POST", fetchImpl, `checkout-${input.workspaceId}-${digest}`);
  return url;
}

/** URL of the Stripe Customer Portal (change plan, card, invoices, cancel). */
export async function createPortalUrl(
  config: StripeConfig,
  input: { customerId: string; returnUrl: string },
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const { url } = await stripeRequest<{ url: string }>(
    config,
    "/billing_portal/sessions",
    { customer: input.customerId, return_url: input.returnUrl },
    "POST",
    fetchImpl,
  );
  return url;
}
