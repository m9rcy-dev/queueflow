import { useEffect, useRef } from "react";
import { Input } from "./Input";

const CODE_LENGTH = 6;

export interface OtpCodeInputProps {
  label: string;
  value: string;
  onChange: (digits: string) => void;
  /** Called once, as soon as all 6 digits are in — typed, pasted, or filled by the phone. */
  onComplete: (code: string) => void;
  /** While true (a check in flight), further input is ignored so one code is never submitted twice. */
  disabled?: boolean;
  error?: string;
  autoFocus?: boolean;
}

/**
 * The one code box for every login/verify screen (Phase 15): emailed codes
 * and authenticator codes alike. Submits by itself the moment it holds 6
 * digits, so pasting a code logs straight in. Pasted text is tidied first
 * ("123 456" and "123-456" from emails both work), so there's deliberately
 * no maxLength on the input — that would truncate a spaced paste.
 * `autocomplete="one-time-code"` lets iOS/Android offer the code from an
 * email or text above the keyboard. The hint keeps the auto-submit from
 * surprising anyone (WCAG 3.2.2); the caller still renders a submit button.
 */
export function OtpCodeInput({
  label,
  value,
  onChange,
  onComplete,
  disabled,
  error,
  autoFocus,
}: OtpCodeInputProps) {
  const submitted = useRef<string | null>(null);

  // Cleared by the caller after a wrong code — the next complete code may submit again.
  useEffect(() => {
    if (value.length < CODE_LENGTH) submitted.current = null;
  }, [value]);

  function handleChange(raw: string): void {
    if (disabled) return;
    const digits = raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
    onChange(digits);
    if (digits.length === CODE_LENGTH && submitted.current !== digits) {
      submitted.current = digits;
      onComplete(digits);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        label={label}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        readOnly={disabled}
        error={error}
        className="text-center font-mono text-2xl tracking-[0.5em]"
      />
      <p className="text-sm text-text-secondary">
        We&apos;ll check the code as soon as all 6 digits are in.
      </p>
    </div>
  );
}
