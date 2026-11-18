"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPublicBaseUrl } from "@/lib/config/publicBaseUrl";
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "@/lib/workspace/reservedSlugs";
import { isBillingPlanId } from "@/features/billing/plans";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getSession } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { getCurrentSubscription, getWorkspaceCustomerId } from "@/server/billing/subscriptions";
import {
  BillingError,
  billingErrorCode,
  createCheckoutUrl,
  createPortalUrl,
  getStripeConfig,
  setCancelAtPeriodEnd,
  type StripeConfig,
} from "@/server/billing/stripe";

/**
 * Settings -> Billing. The slug is validated before it goes into any redirect
 * target, the workspace comes from the SESSION (slug verified against the
 * user's membership), only `billing.manage` (owner) may proceed, and every
 * failure lands back on the page as `?status=error`.
 */
function billingPagePath(workspaceSlug: unknown): string {
  if (typeof workspaceSlug !== "string" || workspaceSlug.length > SLUG_MAX_LENGTH || !SLUG_PATTERN.test(workspaceSlug)) {
    redirect("/");
  }
  return `/${workspaceSlug}/settings/billing`;
}

async function billingContext(workspaceSlug: string): Promise<{ config: StripeConfig; workspaceId: string; pageUrl: string }> {
  if (isDemoWorkspaceSlug(workspaceSlug)) throw new BillingError("demo_workspace");
  const session = await getSession(workspaceSlug);
  assertCan(session.role, "billing.manage");
  const config = getStripeConfig();
  const { baseUrl } = getPublicBaseUrl((await headers()).get("host"));
  if (!config || !baseUrl) throw new BillingError("not_configured");
  return { config, workspaceId: session.workspaceId, pageUrl: `${baseUrl}/${workspaceSlug}/settings/billing` };
}

function logFailure(error: unknown) {
  console.error("[billing]", billingErrorCode(error));
}

export async function startCheckoutAction(workspaceSlug: string, planId: string): Promise<void> {
  const page = billingPagePath(workspaceSlug);
  let target = `${page}?status=error`;
  try {
    if (!isBillingPlanId(planId)) throw new BillingError("unknown_plan");
    const { config, workspaceId, pageUrl } = await billingContext(workspaceSlug);
    // Already subscribed (e.g. a stale tab): show the current plan instead of charging twice.
    target = (await getCurrentSubscription(config, workspaceId))
      ? page
      : await createCheckoutUrl(config, {
          planId,
          workspaceId,
          customerId: await getWorkspaceCustomerId(config, workspaceId),
          successUrl: `${pageUrl}?status=success`,
          cancelUrl: `${pageUrl}?status=canceled`,
        });
  } catch (error) {
    logFailure(error);
  }
  redirect(target);
}

export async function openBillingPortalAction(workspaceSlug: string): Promise<void> {
  const page = billingPagePath(workspaceSlug);
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

async function changeCancellation(workspaceSlug: string, cancel: boolean): Promise<void> {
  const page = billingPagePath(workspaceSlug);
  let target = `${page}?status=error`;
  try {
    const { config, workspaceId } = await billingContext(workspaceSlug);
    const subscription = await getCurrentSubscription(config, workspaceId);
    if (subscription) await setCancelAtPeriodEnd(config, subscription.subscriptionId, cancel);
    target = page;
  } catch (error) {
    logFailure(error);
  }
  redirect(target);
}

/** The plan stays active until the end of the paid period, then Stripe ends it (the webhook records that). */
export async function cancelSubscriptionAction(workspaceSlug: string): Promise<void> {
  await changeCancellation(workspaceSlug, true);
}

export async function resumeSubscriptionAction(workspaceSlug: string): Promise<void> {
  await changeCancellation(workspaceSlug, false);
}
