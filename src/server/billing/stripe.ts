import "server-only";
import type { BillingPlanId } from "@/features/billing/plans";

/**
 * Stripe adapter (hosted Checkout + Customer Portal): plain `fetch`, no SDK
 * dependency. Nothing is stored on our side: a subscription carries
 * `metadata.workspace_id`, and Stripe is asked for it when needed.
 */
const API_BASE = "https://api.stripe.com/v1";
const REQUEST_TIMEOUT_MS = 10_000;

/** A subscription in these states still occupies the workspace: never sell a second one. */
const OCCUPYING_STATUSES = new Set(["active", "trialing", "past_due", "unpaid"]);

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface StripeConfig {
  secretKey: string;
  prices: Record<BillingPlanId, string>;
}

export interface WorkspaceSubscription {
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
    data: { status: string; customer: string; items: { data: { price: { id: string } }[] } }[];
  }>(
    config,
    "/subscriptions/search",
    { query: `metadata['workspace_id']:'${workspaceId.replace(/[\\']/g, "\\$&")}'`, limit: "100" },
    "GET",
    fetchImpl,
  );
  const current = data.find((subscription) => OCCUPYING_STATUSES.has(subscription.status));
  if (!current) return null;
  const priceId = current.items.data[0]?.price.id;
  const planId = (Object.keys(config.prices) as BillingPlanId[]).find((id) => config.prices[id] === priceId) ?? null;
  return { customerId: current.customer, planId };
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
