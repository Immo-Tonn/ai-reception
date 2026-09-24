"use client";

import { useCallback, useEffect, useState } from "react";
import { clientAuthService } from "./authService";
import { CLIENT_IDENTITY_CHANGE_EVENT } from "./DemoAuthProvider";
import type { ClientIdentity } from "./types";

export function useClientAuth() {
  const [identity, setIdentity] = useState<ClientIdentity | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setIdentity(clientAuthService.getCurrentClient());
    setLoaded(true);
    const onChange = () => setIdentity(clientAuthService.getCurrentClient());
    window.addEventListener(CLIENT_IDENTITY_CHANGE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(CLIENT_IDENTITY_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const signIn = useCallback((next: ClientIdentity) => {
    clientAuthService.signIn(next);
    setIdentity(next);
  }, []);

  const signOut = useCallback(() => {
    clientAuthService.signOut();
    setIdentity(null);
  }, []);

  return { identity, loaded, signIn, signOut };
}
