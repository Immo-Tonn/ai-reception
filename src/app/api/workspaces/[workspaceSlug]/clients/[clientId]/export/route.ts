import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/server/auth/session";
import { toActionError } from "@/server/actions/result";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { exportClientData } from "@/server/services/clientExport.service";

/**
 * POST — export ONE client's data as a JSON download (GDPR access / portability).
 * Owner / admin only; the service and the database check it again. The response
 * is never cached (no-store, private) and never stored: no Storage, no public
 * link, no database copy. Nothing of the content is logged. A client of another
 * workspace answers exactly like a missing one (404).
 */
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

const STATUS: Record<string, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  conflict: 409,
};

function fail(code: string) {
  return NextResponse.json({ error: code }, { status: STATUS[code] ?? 500, headers: PRIVATE_HEADERS });
}

/** Same-origin JSON only: a form post or a cross-site page cannot trigger an export with the user's cookies. */
function isSameOriginJson(request: NextRequest): boolean {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return false;
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? request.nextUrl.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ workspaceSlug: string; clientId: string }> }) {
  const { workspaceSlug, clientId } = await ctx.params;
  if (isDemoWorkspaceSlug(workspaceSlug)) return fail("not_found");
  if (!isSameOriginJson(request)) return fail("forbidden");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_input");
  }
  try {
    const session = await getSession(workspaceSlug);
    const data = await exportClientData(session, clientId, body as Parameters<typeof exportClientData>[2]);
    const day = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="client-export-${day}.json"`,
      },
    });
  } catch (error) {
    const code = toActionError(error);
    if (code === "unknown") console.error("[client export] failed:", error instanceof Error ? error.name : "unknown");
    return fail(code);
  }
}
