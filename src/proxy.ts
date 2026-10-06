import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refreshes the Supabase Auth session cookie on every request.
 *
 * Server Components can read cookies but can't write them, so without
 * this the access token would silently expire (~1h) and users would
 * appear logged out even though their refresh token is still valid.
 * This is the standard @supabase/ssr Next.js pattern — see
 * https://supabase.com/docs/guides/auth/server-side/nextjs.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Touching auth here is what actually triggers the refresh + rewrite of
  // the session cookie when the access token is close to/past expiry.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets and Next internals — auth
     * cookies matter on pages and Server Actions, not on images/fonts.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js).*)",
  ],
};
