"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * A value that only exists in the browser (time zone, "mounted"), read without
 * a setState-in-effect: the server render (and hydration) use `serverValue`,
 * the browser then uses `read()`. `read` must return a primitive or a stable
 * reference.
 */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noSubscription, read, () => serverValue);
}

/** True after hydration (e.g. before using a portal into document.body). */
export function useIsClient(): boolean {
  return useClientValue(() => true, false);
}
