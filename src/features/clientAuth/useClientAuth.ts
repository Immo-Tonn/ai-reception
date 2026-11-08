"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { clientAuthService } from "./authService";
import { CLIENT_IDENTITY_CHANGE_EVENT } from "./DemoAuthProvider";
import type { ClientIdentity } from "./types";

function subscribe(onChange: () => void) {
  window.addEventListener(CLIENT_IDENTITY_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CLIENT_IDENTITY_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Serialized so the snapshot is a stable primitive between renders. */
const readIdentity = () => JSON.stringify(clientAuthService.getCurrentClient());

export function useClientAuth() {
  // Server render / hydration: no identity, not loaded. Browser: the stored identity.
  const raw = useSyncExternalStore(subscribe, readIdentity, () => null);
  const loaded = raw !== null;
  const identity = useMemo<ClientIdentity | null>(() => (raw ? (JSON.parse(raw) as ClientIdentity | null) : null), [raw]);

  // The service dispatches CLIENT_IDENTITY_CHANGE_EVENT, so the store re-reads by itself.
  const signIn = useCallback((next: ClientIdentity) => clientAuthService.signIn(next), []);
  const signOut = useCallback(() => clientAuthService.signOut(), []);

  return { identity, loaded, signIn, signOut };
}
