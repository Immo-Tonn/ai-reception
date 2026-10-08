/**
 * Supabase connection settings — read from the environment only. Nothing
 * here (or anywhere in the repo) names a specific Supabase project: pointing
 * ServiceOS at another project is a pure ENV change (see
 * docs/BOOTSTRAP_NEW_SUPABASE.md).
 *
 * The app must keep working when Supabase is NOT configured (demo and
 * public routes never need it), so everything here returns `null` instead
 * of throwing. Only code that truly needs the database calls
 * `requireSupabaseConfig()`.
 */

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export interface SupabaseEnv {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).");
    this.name = "SupabaseNotConfiguredError";
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function readProcessEnv(): SupabaseEnv {
  // Explicit property access: Next.js inlines NEXT_PUBLIC_* by name.
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function getSupabaseConfig(env: SupabaseEnv = readProcessEnv()): SupabaseConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey || !isHttpUrl(url)) return null;
  return { url: url.replace(/\/+$/, ""), anonKey };
}

export function isSupabaseConfigured(env: SupabaseEnv = readProcessEnv()): boolean {
  return getSupabaseConfig(env) !== null;
}

export function requireSupabaseConfig(env: SupabaseEnv = readProcessEnv()): SupabaseConfig {
  const config = getSupabaseConfig(env);
  if (!config) throw new SupabaseNotConfiguredError();
  return config;
}
