import { NextResponse, type NextRequest } from "next/server";

// Phase 12, G-41/G-08: the refresh token lives in localStorage (see
// staff-api-client.ts / customer-api-client.ts), so it's readable by any
// script that runs on this origin — a strict CSP is the real mitigation for
// that XSS exposure (G-08), not a nice-to-have. Nonce-based per the Next.js
// App Router's documented pattern: the framework auto-applies this nonce to
// the inline hydration scripts it injects for RSC streaming, so we don't
// have to thread it through every layout/page ourselves.

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
  // The API's origin (see lib/api-url.ts): explicit when deployed; locally,
  // port 4001 on whatever host this page was requested on — so a phone on
  // the same Wi-Fi (http://<mac-ip>:4000) is allowed to reach <mac-ip>:4001.
  // The Host header, not request.nextUrl: in development Next reports its own
  // bound hostname there, not the address the browser actually used.
  const requestHost = (request.headers.get("host") ?? "localhost").replace(/:\d+$/, "");
  const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? `http://${requestHost}:4001`;
  const csp = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`};
    connect-src 'self' ${apiOrigin};
    img-src 'self' data: ${apiOrigin};
    font-src 'self';
    worker-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    ${
      // Production is HTTPS-only. Locally it would rewrite a phone's
      // http://<mac-ip> requests to https://, which no dev server answers.
      isDev ? "" : "upgrade-insecure-requests;"
    }
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
