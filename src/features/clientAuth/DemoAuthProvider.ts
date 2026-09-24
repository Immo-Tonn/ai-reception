import type { ClientAuthProvider, ClientIdentity } from "./types";

const STORAGE_KEY = "serviceos:client-identity";
const CHANGE_EVENT = "serviceos:client-identity-changed";

/**
 * No real auth yet (§ "не делай fake production auth") — "signed in"
 * means this browser's localStorage remembers your name/email/phone,
 * the same persistence model as every other piece of demo data in this
 * project. No password is actually verified anywhere; a password field
 * in the UI is cosmetic (matches the spec'd Login/Signup layout) and
 * never checked against anything. Never claims a real Google sign-in —
 * see the Login/Signup pages for how that's presented.
 */
export const demoClientAuthProvider: ClientAuthProvider = {
  getCurrentClient(): ClientIdentity | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ClientIdentity) : null;
    } catch {
      return null;
    }
  },
  signIn(identity: ClientIdentity) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  },
  signOut() {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  },
};

export { CHANGE_EVENT as CLIENT_IDENTITY_CHANGE_EVENT };
