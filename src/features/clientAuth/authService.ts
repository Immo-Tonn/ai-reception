import { demoClientAuthProvider } from "./DemoAuthProvider";
import type { ClientAuthProvider } from "./types";

/**
 * AuthService → AuthProvider → DemoAuthProvider (now) → SupabaseAuthProvider
 * (later). Every client-side screen imports THIS, never a concrete
 * provider — so connecting real auth later is a one-line swap here, not a
 * rewrite of `/client/*`.
 */
export const clientAuthService: ClientAuthProvider = demoClientAuthProvider;

export type { ClientIdentity, ClientAuthProvider } from "./types";
