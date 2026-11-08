"use client";

import { useSyncExternalStore } from "react";

/**
 * App-wide "something is being saved" counter. Every data change made through
 * the repository hooks (confirm, mark, save, delete, ...) is wrapped in
 * `trackBusy`, and `<BusyBar>` shows a thin bar while the count is above zero —
 * so a tap always gets visible feedback even when the server needs a second.
 */
let pending = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export async function trackBusy<T>(work: Promise<T>): Promise<T> {
  pending += 1;
  emit();
  try {
    return await work;
  } finally {
    pending -= 1;
    emit();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useIsBusy(): boolean {
  return useSyncExternalStore(subscribe, () => pending > 0, () => false);
}
