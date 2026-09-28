import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "destructive";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "bg-surface text-text-primary border border-border hover:bg-bg",
  destructive: "bg-surface text-red-600 border border-red-200 hover:bg-red-50",
};

/**
 * Primary action hierarchy per the visual doc (§6) — one obvious primary
 * action per screen, secondary actions stay quiet. Large touch target
 * (mobile-first, plan §52).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", className = "", ...props }, ref) => (
    <button
      ref={ref}
      className={[
        "inline-flex min-h-[48px] items-center justify-center rounded-md px-6 py-3 text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_CLASSES[variant],
        className,
      ].join(" ")}
      {...props}
    />
  ),
);
Button.displayName = "Button";
