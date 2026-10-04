/**
 * QueueFlow's own logo (Phase 19): a QR finder pattern as the bowl of a Q,
 * with a line of people flowing out as its tail. Inline SVG so it needs no
 * request and scales crisply; `public/queueflow-mark.svg` is the same mark
 * as a file (and the source of the PNG app icons).
 */
export function QueueFlowMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="15" fill="#5267E8" />
      <rect
        x="12.5"
        y="12.5"
        width="28"
        height="28"
        rx="8.5"
        fill="none"
        stroke="#fff"
        strokeWidth="5"
      />
      <rect x="21" y="21" width="11" height="11" rx="3" fill="#fff" />
      <circle cx="44" cy="44" r="3.8" fill="#fff" />
      <circle cx="50" cy="50" r="3" fill="#fff" fillOpacity=".8" />
      <circle cx="54.8" cy="54.8" r="2.3" fill="#fff" fillOpacity=".55" />
    </svg>
  );
}

/** The mark plus the "QueueFlow" wordmark. `tone="dark"` for dark backgrounds (the TV board). */
export function QueueFlowLogo({
  size = "md",
  tone = "light",
}: {
  size?: "sm" | "md" | "lg";
  tone?: "light" | "dark";
}) {
  const mark = { sm: "h-5 w-5", md: "h-8 w-8", lg: "h-12 w-12" }[size];
  const text = { sm: "text-sm", md: "text-xl", lg: "text-3xl" }[size];
  return (
    <span className="inline-flex items-center gap-2" role="img" aria-label="QueueFlow">
      <QueueFlowMark className={mark} />
      <span className={`${text} font-bold tracking-tight`} aria-hidden="true">
        <span className={tone === "dark" ? "text-white" : "text-text-primary"}>Queue</span>
        <span className={tone === "dark" ? "text-sky-300" : "text-primary"}>Flow</span>
      </span>
    </span>
  );
}

/**
 * QueueFlow's mark next to a business's own branding (Phase 19): the
 * business leads, QueueFlow stays visible.
 */
export function PoweredByQueueFlow({ tone = "light" }: { tone?: "light" | "dark" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${
        tone === "dark" ? "text-white/50" : "text-text-secondary"
      }`}
    >
      Powered by
      <QueueFlowLogo size="sm" tone={tone} />
    </span>
  );
}
