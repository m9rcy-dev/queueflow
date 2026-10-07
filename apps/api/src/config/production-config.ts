/**
 * Production start-up checks (Phase 20). Every setting a live deploy needs
 * is checked once, before the app starts, and every problem is reported
 * together — so a misconfigured deploy fails loudly on the first boot
 * rather than running with a public development secret, emails that link
 * to localhost, or codes that are never sent. Outside production nothing
 * here applies: local development and tests keep their defaults.
 */

const DEV_JWT_SECRET = "dev-only-change-me";

export interface ConfigCheck {
  errors: string[];
  warnings: string[];
}

type Env = Record<string, string | undefined>;

function isHttpsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function checkProductionConfig(env: Env): ConfigCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (env.NODE_ENV !== "production") return { errors, warnings };

  if (!env.DATABASE_URL) errors.push("DATABASE_URL is not set.");

  const secret = env.JWT_ACCESS_SECRET;
  if (!secret || secret === DEV_JWT_SECRET || secret.length < 32) {
    errors.push(
      "JWT_ACCESS_SECRET must be set to a random value of at least 32 characters (it signs every login).",
    );
  }

  const key = env.AUTHENTICATOR_ENCRYPTION_KEY;
  if (!key || Buffer.from(key, "base64").length !== 32) {
    errors.push(
      "AUTHENTICATOR_ENCRYPTION_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32).",
    );
  }

  for (const name of ["WEB_APP_URL", "API_PUBLIC_URL"] as const) {
    if (!isHttpsUrl(env[name])) {
      errors.push(`${name} must be the public https:// address (it's used in emails).`);
    }
  }

  const corsOrigins = (env.CORS_ORIGINS ?? "").split(",").filter((o) => o.trim());
  for (const origin of corsOrigins) {
    if (!isHttpsUrl(origin.trim()))
      errors.push(`CORS_ORIGINS entry "${origin.trim()}" isn't https://.`);
  }

  const email = env.EMAIL_PROVIDER ?? "mock";
  if (email === "mock") {
    errors.push(
      'EMAIL_PROVIDER is "mock" — login codes would never be sent. Use "pingram" (or "smtp").',
    );
  } else if (email === "pingram") {
    if (!env.PINGRAM_API_KEY) errors.push("PINGRAM_API_KEY is not set.");
    if (!env.PINGRAM_FROM_EMAIL) errors.push("PINGRAM_FROM_EMAIL is not set.");
  } else if (email === "smtp") {
    if (!env.SMTP_HOST) errors.push("SMTP_HOST is not set.");
  }

  if (env.DISABLE_RATE_LIMITING === "true") {
    errors.push("DISABLE_RATE_LIMITING must not be set in production.");
  }
  if (env.DISABLE_SCHEDULED_JOBS === "true") {
    warnings.push(
      "DISABLE_SCHEDULED_JOBS is set: no-shows won't be marked and appointment reminders won't be sent.",
    );
  }
  if ((env.SMS_PROVIDER ?? "mock") === "mock") {
    warnings.push(
      "No SMS provider: customers who give only a phone number get no notifications. Ask for an email when joining.",
    );
  }
  if (!env.PLATFORM_ADMIN_EMAILS) {
    warnings.push(
      "PLATFORM_ADMIN_EMAILS is empty: nobody can sign in at /platform to onboard businesses.",
    );
  }
  return { errors, warnings };
}

/** The web app's origin(s) allowed to call the API: CORS_ORIGINS, else WEB_APP_URL's origin. */
export function allowedOrigins(env: Env): string[] {
  const listed = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (listed.length > 0) return listed;
  return env.WEB_APP_URL ? [new URL(env.WEB_APP_URL).origin] : [];
}

/**
 * How many proxies sit in front of the API (Render's load balancer: 1), so
 * the visitor's own IP is used for rate limits rather than the proxy's —
 * without it every visitor shares one limit. TRUST_PROXY_HOPS overrides.
 */
export function trustProxyHops(env: Env): number {
  if (env.TRUST_PROXY_HOPS !== undefined) return Math.max(0, Number(env.TRUST_PROXY_HOPS) || 0);
  return env.NODE_ENV === "production" ? 1 : 0;
}

/** Public business sign-up (the API route): off in production unless switched on — businesses are onboarded from /platform. */
export function businessSignupEnabled(env: Env): boolean {
  if (env.BUSINESS_SIGNUP_ENABLED !== undefined) return env.BUSINESS_SIGNUP_ENABLED === "true";
  return env.NODE_ENV !== "production";
}
