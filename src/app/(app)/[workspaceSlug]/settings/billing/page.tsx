import { notFound } from "next/navigation";
import { Icon } from "@/components/ui";
import { BILLING_PLANS } from "@/features/billing/plans";
import { getWorkspaceConfig, isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import {
  cancelSubscriptionAction,
  openBillingPortalAction,
  resumeSubscriptionAction,
  startCheckoutAction,
} from "@/server/actions/billing.actions";
import { getSession } from "@/server/auth/session";
import { fetchSubscription, getStripeConfig, type StripeSubscriptionState, type WorkspaceSubscription } from "@/server/billing/stripe";
import { getCurrentSubscription } from "@/server/billing/subscriptions";
import { can } from "@/server/permissions/roles";
import { getBusinessProfile } from "@/server/services/businessProfile.service";
import { SettingsHeader } from "../SettingsHeader";
import schedulingStyles from "../scheduling.module.css";
import { CancelSubscription } from "./CancelSubscription";
import { PendingButton } from "./PendingButton";
import styles from "./billing.module.css";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ workspaceSlug }, { status }, locale] = await Promise.all([params, searchParams, getRequestLocale()]);
  const { billing: m, common, bookingSettings } = getMessages(locale);

  const config = getStripeConfig();
  let businessName: string;
  let blockedNotice: string | null = null;
  let subscription: WorkspaceSubscription | null = null;
  let live: StripeSubscriptionState | null = null;

  if (isDemoWorkspaceSlug(workspaceSlug)) {
    businessName = getWorkspaceConfig(workspaceSlug).name;
    blockedNotice = m.demoNotice;
  } else {
    let session;
    try {
      session = await getSession(workspaceSlug);
    } catch {
      notFound();
    }
    businessName = (await getBusinessProfile(session).catch(() => null))?.name ?? "";
    if (!can(session.role, "billing.manage")) {
      blockedNotice = m.forbiddenNotice;
    } else if (!config) {
      blockedNotice = m.notConfiguredNotice;
    } else {
      try {
        subscription = await getCurrentSubscription(config, session.workspaceId);
        if (subscription) live = await fetchSubscription(config, subscription.subscriptionId);
      } catch (error) {
        console.error("[billing]", error instanceof Error ? error.message : "unknown failure");
        // Unknown state: selling a plan now could charge the workspace twice.
        blockedNotice = m.errorNotice;
      }
    }
  }

  const statusNotice =
    status === "success" ? m.successNotice : status === "canceled" ? m.canceledNotice : status === "error" ? m.errorNotice : null;
  const price = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const endDate = live?.cancelAt ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(live.cancelAt * 1000)) : null;

  return (
    <main className={`${schedulingStyles.page} ${styles.wide}`}>
      <SettingsHeader
        workspaceSlug={workspaceSlug}
        title={m.title}
        subtitle={m.subtitle}
        businessLabel={m.businessLabel}
        businessName={businessName}
        backLabel={common.back}
        dirty={false}
        discard={bookingSettings}
      />

      {statusNotice && statusNotice !== blockedNotice && <p className={schedulingStyles.notice} role="status">{statusNotice}</p>}
      {blockedNotice && <p className={schedulingStyles.notice} role="status">{blockedNotice}</p>}
      {live?.cancelScheduled && (
        <p className={schedulingStyles.notice} role="status">
          {endDate ? m.cancelScheduledOnNotice.replace("{date}", endDate) : m.cancelScheduledNotice}
        </p>
      )}

      <div className={styles.plans}>
        {BILLING_PLANS.map((plan) => {
          const text = m.plans[plan.id];
          const isCurrent = subscription?.planId === plan.id;
          return (
            <section key={plan.id} className={`${styles.plan} ${isCurrent ? styles.planCurrent : ""}`}>
              <h2 className={styles.planName}>
                {text.name}
                {isCurrent && <span className={schedulingStyles.badge}>{m.currentBadge}</span>}
              </h2>
              <p className={styles.price}>
                {price.format(plan.priceEur)} <span className={styles.period}>{m.perMonth}</span>
              </p>
              <ul className={styles.features}>
                {text.features.map((feature) => (
                  <li key={feature} className={styles.feature}>
                    <Icon name="check" size={16} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <p className={styles.support}>{text.support}</p>
              {!subscription && (
                <form suppressHydrationWarning action={startCheckoutAction.bind(null, workspaceSlug, plan.id)}>
                  <PendingButton fullWidth disabled={blockedNotice !== null} label={m.choose} pendingLabel={m.redirecting} />
                </form>
              )}
            </section>
          );
        })}
      </div>

      <p className={schedulingStyles.hint}>{m.taxNote}</p>

      {subscription && (
        <form suppressHydrationWarning action={openBillingPortalAction.bind(null, workspaceSlug)} className={schedulingStyles.actions} style={{ marginTop: "var(--space-4)" }}>
          <PendingButton variant="secondary" label={m.manage} pendingLabel={m.redirecting} />
        </form>
      )}

      {live && !live.cancelScheduled && <CancelSubscription action={cancelSubscriptionAction.bind(null, workspaceSlug)} messages={m} />}
      {live?.cancelScheduled && (
        <form suppressHydrationWarning action={resumeSubscriptionAction.bind(null, workspaceSlug)} className={schedulingStyles.actions} style={{ marginTop: "var(--space-3)" }}>
          <PendingButton variant="secondary" label={m.resume} pendingLabel={m.resuming} />
        </form>
      )}
    </main>
  );
}
