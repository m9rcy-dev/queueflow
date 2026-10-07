import {
  allowedOrigins,
  businessSignupEnabled,
  checkProductionConfig,
  trustProxyHops,
} from "./production-config";

const GOOD = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@db.example.com/queueflow",
  JWT_ACCESS_SECRET: "x".repeat(48),
  AUTHENTICATOR_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  WEB_APP_URL: "https://q.example.com",
  API_PUBLIC_URL: "https://api.q.example.com",
  EMAIL_PROVIDER: "pingram",
  PINGRAM_API_KEY: "key",
  PINGRAM_FROM_EMAIL: "noreply@example.com",
  PLATFORM_ADMIN_EMAILS: "root@example.com",
};

describe("production config checks (Phase 20)", () => {
  it("passes a complete production setup (the only warning: no SMS provider)", () => {
    const { errors, warnings } = checkProductionConfig(GOOD);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([expect.stringMatching(/SMS/)]);
  });

  it("checks nothing outside production", () => {
    expect(checkProductionConfig({ NODE_ENV: "development" })).toEqual({
      errors: [],
      warnings: [],
    });
    expect(checkProductionConfig({})).toEqual({ errors: [], warnings: [] });
  });

  it("reports every problem at once", () => {
    const { errors } = checkProductionConfig({ NODE_ENV: "production" });
    const text = errors.join("\n");
    for (const name of [
      "DATABASE_URL",
      "JWT_ACCESS_SECRET",
      "AUTHENTICATOR_ENCRYPTION_KEY",
      "WEB_APP_URL",
      "API_PUBLIC_URL",
      "EMAIL_PROVIDER",
    ]) {
      expect(text).toContain(name);
    }
  });

  it("refuses the public development secret, short secrets, http URLs and a mock email provider", () => {
    const bad = checkProductionConfig({
      ...GOOD,
      JWT_ACCESS_SECRET: "dev-only-change-me",
      WEB_APP_URL: "http://q.example.com",
      EMAIL_PROVIDER: "mock",
      DISABLE_RATE_LIMITING: "true",
      AUTHENTICATOR_ENCRYPTION_KEY: "too-short",
    }).errors.join("\n");
    expect(bad).toMatch(/JWT_ACCESS_SECRET/);
    expect(bad).toMatch(/WEB_APP_URL/);
    expect(bad).toMatch(/EMAIL_PROVIDER/);
    expect(bad).toMatch(/DISABLE_RATE_LIMITING/);
    expect(bad).toMatch(/AUTHENTICATOR_ENCRYPTION_KEY/);
    expect(checkProductionConfig({ ...GOOD, JWT_ACCESS_SECRET: "short" }).errors).toHaveLength(1);
  });

  it("needs the chosen email provider's own settings", () => {
    expect(checkProductionConfig({ ...GOOD, PINGRAM_API_KEY: undefined }).errors).toEqual([
      "PINGRAM_API_KEY is not set.",
    ]);
    expect(
      checkProductionConfig({ ...GOOD, EMAIL_PROVIDER: "smtp", SMTP_HOST: undefined }).errors,
    ).toEqual(["SMTP_HOST is not set."]);
  });

  it("allows only the web app's origin by default, or the listed ones", () => {
    expect(allowedOrigins(GOOD)).toEqual(["https://q.example.com"]);
    expect(
      allowedOrigins({ ...GOOD, CORS_ORIGINS: "https://a.example.com/, https://b.example.com" }),
    ).toEqual(["https://a.example.com", "https://b.example.com"]);
    expect(
      checkProductionConfig({ ...GOOD, CORS_ORIGINS: "http://a.example.com" }).errors,
    ).toHaveLength(1);
  });

  it("trusts one proxy hop in production by default, none locally", () => {
    expect(trustProxyHops(GOOD)).toBe(1);
    expect(trustProxyHops({ NODE_ENV: "development" })).toBe(0);
    expect(trustProxyHops({ ...GOOD, TRUST_PROXY_HOPS: "2" })).toBe(2);
  });

  it("keeps public business sign-up off in production unless switched on", () => {
    expect(businessSignupEnabled(GOOD)).toBe(false);
    expect(businessSignupEnabled({ ...GOOD, BUSINESS_SIGNUP_ENABLED: "true" })).toBe(true);
    expect(businessSignupEnabled({ NODE_ENV: "test" })).toBe(true);
  });
});
