/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
