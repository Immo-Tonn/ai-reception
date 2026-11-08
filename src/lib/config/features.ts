/**
 * Product feature flags for modules that exist (code, tables and data stay) but
 * are not shown to businesses yet. Driven by ONE server variable:
 *
 *   SERVICEOS_FEATURES = "finance,analytics"   (comma list, case-insensitive)
 *
 * - Variable SET: exactly the listed modules are on (empty string = all off).
 * - Variable NOT set: on in development / tests, OFF in production builds
 *   (Vercel production AND preview run with NODE_ENV=production).
 *
 * Re-enabling a module = add it to SERVICEOS_FEATURES in the Vercel project
 * and redeploy. Not a secret, not an authorization mechanism (permissions and
 * RLS still apply on top). Read on the server only; the client gets the
 * resolved booleans from the workspace layout.
 */
export const PRODUCT_FEATURES = ["finance", "analytics"] as const;
export type ProductFeature = (typeof PRODUCT_FEATURES)[number];
export type FeatureFlags = Record<ProductFeature, boolean>;

export function resolveFeatureFlags(raw: string | undefined | null, nodeEnv: string | undefined): FeatureFlags {
  if (raw === undefined || raw === null) {
    const on = nodeEnv !== "production";
    return { finance: on, analytics: on };
  }
  const listed = new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  return { finance: listed.has("finance"), analytics: listed.has("analytics") };
}

/** Server-side: the flags of this deployment. */
export function getFeatureFlags(): FeatureFlags {
  return resolveFeatureFlags(process.env.SERVICEOS_FEATURES, process.env.NODE_ENV);
}

export function isFeatureEnabled(feature: ProductFeature): boolean {
  return getFeatureFlags()[feature];
}
