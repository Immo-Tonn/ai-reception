import "server-only";
import { headers } from "next/headers";

/**
 * Minimal in-memory sliding-window limiter for anonymous endpoints (public
 * booking). Per server instance only — enough to stop a script hammering one
 * booking page; swap for a shared store (Redis/Upstash) when running on
 * several instances.
 */
const hits = new Map<string, number[]>();

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

/** Returns true if the call is allowed (and records it). */
export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, times] of hits) {
      if (times.every((t) => now - t >= windowMs)) hits.delete(k);
    }
  }
  return true;
}
