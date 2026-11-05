"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPublicBaseUrl } from "@/lib/config/publicBaseUrl";
import { isBillingPlanId } from "@/features/billing/plans";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getSession } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { getCurrentSubscription } from "@/server/billing/subscriptions";
import {
  createCheckoutUrl,
  createPortalUrl,
  getStripeConfig,
  type StripeConfig,
} from "@/server/billing/stripe";

/**
 * Settings -> Billing. The workspace comes from the SESSION (route slug verified
 * against the user's membership), only `billing.manage` (owner) may proceed, and
 * every failure lands back on the page as `?status=error`.
 */
async function billingContext(workspaceSlug: string): Promise<{ config: StripeConfig; workspaceId: string; pageUrl: string }> {
  if (isDemoWorkspaceSlug(workspaceSlug)) throw new Error("demo workspace");
  const session = await getSession(workspaceSlug);
  assertCan(session.role, "billing.manage");
  const config = getStripeConfig();
  const { baseUrl } = getPublicBaseUrl((await headers()).get("host"));
  if (!config || !baseUrl) throw new Error("billing not configured");
  return { config, workspaceId: session.workspaceId, pageUrl: `${baseUrl}/${workspaceSlug}/settings/billing` };
}

function logFailure(error: unknown) {
  console.error("[billing]", error instanceof Error ? error.message : "unknown failure");
}

export async function startCheckoutAction(workspaceSlug: string, planId: string): Promise<void> {
  const page = `/${workspaceSlug}/settings/billing`;
  let target = `${page}?status=error`;
  try {
    if (!isBillingPlanId(planId)) throw new Error("unknown plan");
    const { config, workspaceId, pageUrl } = await billingContext(workspaceSlug);
    // Already subscribed (e.g. a stale tab): show the current plan instead of charging twice.
    target = (await getCurrentSubscription(config, workspaceId))
      ? page
      : await createCheckoutUrl(config, {
          planId,
          workspaceId,
          successUrl: `${pageUrl}?status=success`,
          cancelUrl: `${pageUrl}?status=canceled`,
        });
  } catch (error) {
    logFailure(error);
  }
  redirect(target);
}

export async function openBillingPortalAction(workspaceSlug: string): Promise<void> {
  const page = `/${workspaceSlug}/settings/billing`;
  let target = `${page}?status=error`;
  try {
    const { config, workspaceId, pageUrl } = await billingContext(workspaceSlug);
    const subscription = await getCurrentSubscription(config, workspaceId);
    target = subscription ? await createPortalUrl(config, { customerId: subscription.customerId, returnUrl: pageUrl }) : page;
  } catch (error) {
    logFailure(error);
  }
  redirect(target);
}
