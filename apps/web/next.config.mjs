// Phase 20: a deployed build must know where the API is — it's baked into
// the browser bundle at build time, so a missing value would ship a site
// that calls http://<its-own-host>:4001. Fail the Vercel build instead.
if (process.env.VERCEL && !process.env.NEXT_PUBLIC_API_URL) {
  throw new Error(
    "NEXT_PUBLIC_API_URL must be set for a Vercel build (the API's https:// address).",
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Phase 20: `pnpm quality` builds into .next-build, so it no longer
  // overwrites the .next folder a running `next dev` is using (the Phase 17
  // known issue). Vercel and `next dev` use the default.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Phase 12 (pnpm audit): the app never uses next/image anywhere, so
  // there's no reason to let the optimizer run even for the requests
  // middleware.ts doesn't manage to block. See middleware.ts for the actual
  // route block — unoptimized:true alone does NOT remove the /_next/image
  // route (confirmed empirically: it still 200'd with this set).
  images: { unoptimized: true },
  // Phase 12, G-41: CSP itself is set per-request in middleware.ts (needs a
  // fresh nonce each time); these don't vary per request, so they're static
  // here — mirrors the non-CSP headers helmet() already sets on the API.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Phase 19: the camera for our own pages only (the Scan page's camera
          // backup) — never for anything embedded; the browser still asks first.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          // Phase 20: HTTPS only, remembered by the browser (ignored over plain http locally).
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
