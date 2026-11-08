"use client";

import { createContext, useContext } from "react";
import type { FeatureFlags, ProductFeature } from "@/lib/config/features";

/** Default = everything on: components rendered outside the workspace layout behave as before. */
const FeatureFlagsContext = createContext<FeatureFlags>({ finance: true, analytics: true });

export function FeatureFlagsProvider({ value, children }: { value: FeatureFlags; children: React.ReactNode }) {
  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureEnabled(feature: ProductFeature): boolean {
  return useContext(FeatureFlagsContext)[feature];
}
