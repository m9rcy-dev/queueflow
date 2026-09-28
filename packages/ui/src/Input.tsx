import { forwardRef, type InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

let idCounter = 0;

/** Accessible label pairing is not optional (visual doc §24/plan §55) — every input has one, always. */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, id, className = "", ...props }, ref) => {
    const inputId = id ?? `qf-input-${(idCounter += 1)}`;
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium text-text-primary">
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          className={[
            "min-h-[48px] rounded-md border border-border bg-surface px-4 py-3 text-base text-text-primary outline-none focus:border-primary",
            error ? "border-red-400" : "",
            className,
          ].join(" ")}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";
