import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { isRecoveryAllowedPath, RECOVERY_FLAG_COOKIE } from "@/lib/auth/recoveryFlag";

/**
 * Keeps a signed-in business user's Supabase session fresh (Server
 * Components can't write cookies, so the ~1h access token would otherwise
 * silently expire). Deliberately narrow:
 *
 *  - It does NOTHING when Supabase isn't configured.
 *  - It does NOTHING for requests without a Supabase auth cookie — i.e. every
 *    anonymous visitor, guest booking, embed and demo page costs zero
 *    network calls and cannot be broken by Supabase being down.
 *  - The matcher skips public booking, embeds and assets (the client area is covered so client sessions refresh).
 *  - Any failure falls through to a plain `next()`.
 *
 * It never authorizes anything; access control lives in `getSession()` and
 * Row Level Security. The one thing it does besides refreshing: while the
 * "password reset in progress" flag is set (see `lib/auth/recoveryFlag`), a
 * signed-in browser is kept on the set-new-password page. That is a
 * convenience lock for the owner, not an access-control boundary.
 */
export async function proxy(request: NextRequest) {
  const config = getSupabaseConfig();
  const hasAuthCookie = request.cookies.getAll().some((c) => c.name.startsWith("sb-"));
  if (!config || !hasAuthCookie) return NextResponse.next();

  if (request.cookies.has(RECOVERY_FLAG_COOKIE) && !isRecoveryAllowedPath(request.nextUrl.pathname)) {
    if (request.method !== "GET" && request.method !== "HEAD") return new NextResponse(null, { status: 403 });
    return NextResponse.redirect(new URL("/reset-password/new", request.url));
  }

  let response = NextResponse.next({ request });
  try {
    const supabase = createServerClient(config.url, config.anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    });
    await supabase.auth.getUser(); // triggers the refresh + cookie rewrite when needed
  } catch {
    return NextResponse.next();
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|embed.js|book/|book$|embed-demo|business/|business$|impressum$|datenschutz$).*)",
  ],
};
