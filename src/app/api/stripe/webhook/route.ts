import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getStripeConfig, parseSignedEvent } from "@/server/billing/stripe";
import { defaultBillingClient, syncSubscriptionFromEvent } from "@/server/billing/subscriptions";

export const dynamic = "force-dynamic";

const reply = (body: { received: boolean }, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Stripe webhook (docs/STRIPE_SETUP_RU.md). Protected by the signature, using
 * the raw body. Any non-2xx makes Stripe retry for up to three days. Logs carry
 * Stripe's error code only — never ids, e-mail addresses or keys.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const config = getStripeConfig();
  if (!secret || !config || !isSupabaseConfigured()) return reply({ received: false }, 503);

  const event = parseSignedEvent(await request.text(), request.headers.get("stripe-signature"), secret);
  if (!event) return reply({ received: false }, 400);

  try {
    await syncSubscriptionFromEvent(event, config, defaultBillingClient());
    return reply({ received: true }, 200);
  } catch (error) {
    console.error("[billing] webhook:", error instanceof Error ? error.message : "unknown failure");
    return reply({ received: false }, 500);
  }
}
