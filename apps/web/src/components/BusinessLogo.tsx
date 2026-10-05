"use client";

/* eslint-disable @next/next/no-img-element -- next/image is deliberately unused: its optimizer route is blocked in middleware (Phase 12, a reachable critical advisory). */
import { useApiBaseUrl } from "../lib/api-url";

/**
 * The business's own logo on customer-facing pages (Phase 16). `logoPath`
 * comes from the API (null when none is uploaded — then nothing renders,
 * and the page's text heading carries the name as before). The image is
 * decorative next to that heading, hence the empty alt unless it stands
 * alone.
 */
export function BusinessLogo({
  logoPath,
  name,
  size = "md",
  standalone = false,
  centered = true,
}: {
  logoPath: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
  standalone?: boolean;
  /** Centered above a page heading by default; false when it sits beside the name (the TV board's header). */
  centered?: boolean;
}) {
  const apiUrl = useApiBaseUrl();
  if (!logoPath) return null;
  return (
    <img
      src={`${apiUrl}${logoPath}`}
      alt={standalone ? `${name} logo` : ""}
      className={[
        centered ? "mx-auto object-contain" : "shrink-0 object-contain",
        { sm: "max-h-10 max-w-[3rem]", md: "max-h-16 max-w-[12rem]", lg: "max-h-28 max-w-[16rem]" }[
          size
        ],
      ].join(" ")}
    />
  );
}
