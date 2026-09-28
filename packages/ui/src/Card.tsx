import type { HTMLAttributes } from "react";

/** Whitespace over heavy borders (visual doc §5) — subtle border + radius, no drop-shadow heaviness. */
export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={["rounded-lg border border-border bg-surface p-6", className].join(" ")}
      {...props}
    />
  );
}
