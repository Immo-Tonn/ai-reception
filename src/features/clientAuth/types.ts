/** The client-side (end customer, not staff) identity — just enough to
 * prefill/match bookings across businesses in this browser. Not a
 * `ClientRecord` (see HANDOFF_GRAPH.md §7): a ClientRecord is per-workspace
 * business data; this is "who am I" for the person doing the booking. */
export interface ClientIdentity {
  name: string;
  email: string;
  phone: string;
}

/**
 * Contract a real provider (Supabase Auth, later) would satisfy.
 * Components only ever import `clientAuthService` (authService.ts), never
 * a concrete provider — swapping `DemoAuthProvider` for a real one later
 * means changing one file, not every call site (§ provider-agnostic rule).
 */
export interface ClientAuthProvider {
  getCurrentClient(): ClientIdentity | null;
  signIn(identity: ClientIdentity): void;
  signOut(): void;
}
