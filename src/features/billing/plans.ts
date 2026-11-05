/**
 * Business subscription plans shown on Settings -> Billing. Display prices only:
 * the amount actually charged is the Stripe Price behind each plan
 * (STRIPE_PRICE_START / _BUSINESS / _PRO), so keep the two in sync.
 * Plan names, feature lists and support times live in i18n (`billing.plans`).
 */
export const BILLING_PLANS = [
  { id: "start", priceEur: 5 },
  { id: "business", priceEur: 10 },
  { id: "pro", priceEur: 15 },
] as const;

export type BillingPlanId = (typeof BILLING_PLANS)[number]["id"];

export function isBillingPlanId(value: string): value is BillingPlanId {
  return BILLING_PLANS.some((plan) => plan.id === value);
}
