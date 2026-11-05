import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingPlanId } from "@/features/billing/plans";

/**
 * Stripe adapter (hosted Checkout + Customer Portal + webhook signatures):
 * plain `fetch`, no SDK dependency. A subscription carries
 * `metadata.workspace_id`, which ties it to the workspace.
 */
const API_BASE = "https://api.stripe.com/v1";
const REQUEST_TIMEOUT_MS = 10_000;
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

/** Carries only Stripe's status and error type/code — never the key or the request body. */
export class StripeRequestError extends Error {
  constructor(detail: string) {
    super(`Stripe request failed: ${detail}`);
    this.name = "StripeRequestError";
  }
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
): Promise<T> {
  const query = new URLSearchParams(params).toString();
  let response: Response;
  try {
    response = await fetchImpl(method === "GET" ? `${API_BASE}${path}?${query}` : `${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
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
    throw new StripeRequestError(`${response.status} ${body?.error?.type ?? ""} ${body?.error?.code ?? ""}`.trim());
  }
  return body;
}

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
    { query: `metadata['workspace_id']:'${workspaceId.replace(/[\\']/g, "\\$&")}'`, limit: "100" },
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

/** URL of the Stripe-hosted payment page for one plan. */
export async function createCheckoutUrl(
  config: StripeConfig,
  input: { planId: BillingPlanId; workspaceId: string; successUrl: string; cancelUrl: string },
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const { url } = await stripeRequest<{ url: string }>(
    config,
    "/checkout/sessions",
    {
      mode: "subscription",
      "line_items[0][price]": config.prices[input.planId],
      "line_items[0][quantity]": "1",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.workspaceId,
      "metadata[workspace_id]": input.workspaceId,
      "subscription_data[metadata][workspace_id]": input.workspaceId,
    },
    "POST",
    fetchImpl,
  );
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
