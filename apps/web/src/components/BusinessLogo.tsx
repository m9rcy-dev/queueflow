/* eslint-disable @next/next/no-img-element -- next/image is deliberately unused: its optimizer route is blocked in middleware (Phase 12, a reachable critical advisory). */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

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
}: {
  logoPath: string | null;
  name: string;
  size?: "md" | "lg";
  standalone?: boolean;
}) {
  if (!logoPath) return null;
  return (
    <img
      src={`${API_URL}${logoPath}`}
      alt={standalone ? `${name} logo` : ""}
      className={[
        "mx-auto object-contain",
        size === "lg" ? "max-h-28 max-w-[16rem]" : "max-h-16 max-w-[12rem]",
      ].join(" ")}
    />
  );
}
