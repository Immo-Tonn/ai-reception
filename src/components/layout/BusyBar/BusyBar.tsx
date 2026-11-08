"use client";

import { useIsBusy } from "@/lib/ui/busy";
import styles from "./BusyBar.module.css";

/** Thin top bar while a change is being saved (see `trackBusy`). */
export function BusyBar() {
  const busy = useIsBusy();
  return busy ? <div className={styles.bar} aria-hidden="true" /> : null;
}
