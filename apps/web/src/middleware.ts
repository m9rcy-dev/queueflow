import { NextResponse, type NextRequest } from "next/server";

// Phase 12, G-41/G-08: the refresh token lives in localStorage (see
// staff-api-client.ts / customer-api-client.ts), so it's readable by any
// script that runs on this origin — a strict CSP is the real mitigation for
// that XSS exposure (G-08), not a nice-to-have. Nonce-based per the Next.js
// App Router's documented pattern: the framework auto-applies this nonce to
// the inline hydration scripts it injects for RSC streaming, so we don't
// have to thread it through every layout/page ourselves.
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

export function middleware(request: NextRequest) {
  // Phase 12 (pnpm audit): the app never uses next/image, but Next.js
  // still wires up this optimizer route regardless of `images.unoptimized`
  // (confirmed empirically — that config option doesn't remove the route,
  // just changes what it does once hit). Several CVEs, including a
  // critical AVIF-triggered RCE, live in that route's request handling, so
  // it's blocked outright rather than left reachable for a feature nothing
  // here needs.
  if (request.nextUrl.pathname.startsWith("/_next/image")) {
    return new NextResponse(null, { status: 404 });
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`};
    connect-src 'self' ${API_ORIGIN};
    img-src 'self' data:;
    font-src 'self';
    worker-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `
    .replace(/\s{2,}/g, " ")
    .trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // _next/image must stay IN scope (unlike _next/static) so the block
    // above actually runs for it — only truly static assets are skipped.
    "/((?!_next/static|favicon.ico).*)",
  ],
};
