import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isBillingPlanId } from "@/features/billing/plans";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  BillingError,
  billingErrorCode,
  fetchSubscription,
  findOrCreateCustomer,
  findWorkspaceSubscription,
  isOccupyingStatus,
  type StripeConfig,
  type StripeEvent,
  type StripeSubscriptionState,
  type WorkspaceSubscription,
} from "./stripe";

/**
 * Stored subscriptions (migration 0034), written only by the Stripe webhook.
 * Service-role client because the table has no RLS policies; every reader
 * authorizes with `billing.manage` first.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOREIGN_KEY_VIOLATION = "23503";
const SUBSCRIPTION_EVENTS = new Set(["customer.subscription.updated", "customer.subscription.deleted"]);

export function defaultBillingClient(): SupabaseClient {
  return createSupabaseAdminClient();
}

interface StoredRow {
  stripe_subscription_id: string;
  stripe_customer_id: string;
  plan: string | null;
  status: string;
}

const dbErrorCode = (code: string | undefined) => `db_${code && /^[A-Za-z0-9]+$/.test(code) ? code : "unknown"}`;

async function readStoredRow(client: SupabaseClient, workspaceId: string): Promise<StoredRow | null> {
  const { data, error } = await client
    .from("workspace_subscriptions")
    .select("stripe_subscription_id, stripe_customer_id, plan, status")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new BillingError(dbErrorCode(error.code));
  return data as StoredRow | null;
}

async function readStoredSubscription(client: SupabaseClient, workspaceId: string): Promise<WorkspaceSubscription | null> {
  const row = await readStoredRow(client, workspaceId);
  if (!row || !isOccupyingStatus(row.status)) return null;
  return { subscriptionId: row.stripe_subscription_id, customerId: row.stripe_customer_id, planId: row.plan && isBillingPlanId(row.plan) ? row.plan : null };
}

/**
 * The workspace's one Stripe customer, reused for every purchase: the one
 * stored with its (even ended) subscription, else found or created in Stripe.
 */
export async function getWorkspaceCustomerId(
  config: StripeConfig,
  workspaceId: string,
  loadClient: () => SupabaseClient = defaultBillingClient,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  try {
    const stored = await readStoredRow(loadClient(), workspaceId);
    if (stored) return stored.stripe_customer_id;
  } catch (error) {
    console.error("[billing]", billingErrorCode(error));
  }
  return findOrCreateCustomer(config, workspaceId, fetchImpl);
}

/**
 * The workspace's current subscription: the stored row first, then Stripe. The
 * fallback keeps double charging impossible while the webhook is late, or when
 * the code is deployed before migration 0034 / the webhook is set up.
 */
export async function getCurrentSubscription(
  config: StripeConfig,
  workspaceId: string,
  loadClient: () => SupabaseClient = defaultBillingClient,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkspaceSubscription | null> {
  try {
    const stored = await readStoredSubscription(loadClient(), workspaceId);
    if (stored) return stored;
  } catch (error) {
    console.error("[billing]", billingErrorCode(error));
  }
  return findWorkspaceSubscription(config, workspaceId, fetchImpl);
}

async function saveSubscription(client: SupabaseClient, state: StripeSubscriptionState, workspaceId: string): Promise<void> {
  const { error } = await client.rpc("save_workspace_subscription", {
    p_workspace_id: workspaceId,
    p_customer_id: state.customerId,
    p_subscription_id: state.subscriptionId,
    p_plan: state.planId,
    p_status: state.status,
  });
  // A workspace that isn't here belongs to another environment on the same Stripe account: not ours to store.
  if (error && error.code !== FOREIGN_KEY_VIOLATION) throw new BillingError(dbErrorCode(error.code));
}

function subscriptionIdOf(event: StripeEvent): string | null {
  const object = event.data?.object;
  if (event.type === "checkout.session.completed") return object?.subscription ?? null;
  return SUBSCRIPTION_EVENTS.has(event.type) ? (object?.id ?? null) : null;
}

/**
 * Applies a verified webhook event. The event is only a signal: the state is
 * always re-read from Stripe, so repeated or out-of-order events are harmless.
 * Throws on a temporary failure, and the webhook's 500 makes Stripe retry.
 */
export async function syncSubscriptionFromEvent(
  event: StripeEvent,
  config: StripeConfig,
  client: SupabaseClient,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const subscriptionId = subscriptionIdOf(event);
  if (!subscriptionId) return;
  const state = await fetchSubscription(config, subscriptionId, fetchImpl);
  if (!state.workspaceId || !UUID.test(state.workspaceId)) return;
  await saveSubscription(client, state, state.workspaceId);
}
