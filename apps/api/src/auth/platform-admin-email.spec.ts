import { isPlatformAdminEmail } from "./auth.service";

describe("isPlatformAdminEmail (Phase 19, ADR-018)", () => {
  it("matches allow-listed emails, ignoring case and spacing", () => {
    expect(isPlatformAdminEmail("root@queueflow.app, Ops@QueueFlow.app", "ops@queueflow.app")).toBe(
      true,
    );
    expect(isPlatformAdminEmail("root@queueflow.app", " ROOT@queueflow.app ")).toBe(true);
  });

  it("allows nobody when unset or empty, and never matches an empty entry", () => {
    expect(isPlatformAdminEmail(undefined, "root@queueflow.app")).toBe(false);
    expect(isPlatformAdminEmail("", "root@queueflow.app")).toBe(false);
    expect(isPlatformAdminEmail("root@queueflow.app,,", "")).toBe(false);
  });

  it("is an exact match, not a substring", () => {
    expect(isPlatformAdminEmail("root@queueflow.app", "oot@queueflow.app")).toBe(false);
    expect(isPlatformAdminEmail("root@queueflow.app", "root@queueflow.app.evil.com")).toBe(false);
  });
});
