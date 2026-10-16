import { type NextRequest, NextResponse } from "next/server";
import { checkBasicAuth } from "./lib/auth/basic";

/**
 * Basic auth for the admin UI and booth screen (SPEC §10.1). Everything else
 * (webhooks, share page, agent API, health) is public and has its
 * own checks. Fails closed if ADMIN_USER / ADMIN_PASSWORD are not set.
 */
export async function proxy(request: NextRequest) {
  if (await checkBasicAuth(request.headers.get("authorization"), process.env.ADMIN_USER, process.env.ADMIN_PASSWORD)) {
    return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Portrait Studio", charset="UTF-8"', "Cache-Control": "no-store" },
  });
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/booth", "/booth/:path*"],
};
