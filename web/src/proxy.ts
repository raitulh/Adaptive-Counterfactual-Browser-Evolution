import { NextResponse, type NextRequest } from "next/server";

/**
 * Navigation hint only (not a security boundary): visitors to /app without the session's CSRF
 * cookie have never signed in on this browser, so send them to sign-in immediately instead of
 * rendering the app shell first. The backend authorizes every API call regardless.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has("agentos_csrf") && process.env.NEXT_PUBLIC_DEMO_MODE !== "true") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Only app pages: never API traffic (uploads/SSE must not be buffered by the proxy layer).
  matcher: ["/app", "/app/:path*"],
};
