import type { HTMLAttributes } from "react";

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-green-50 text-green-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  info: "bg-blue-50 text-blue-700",
  neutral: "bg-bg text-text-secondary",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** Status is never color-only (plan §55/visual doc §24) — always paired with the text passed as children. */
export function Badge({ tone = "neutral", className = "", ...props }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-sm px-2.5 py-1 text-sm font-medium",
        TONE_CLASSES[tone],
        className,
      ].join(" ")}
      {...props}
    />
  );
}
