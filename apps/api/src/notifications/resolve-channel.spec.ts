import { resolveChannel } from "./resolve-channel";

describe("resolveChannel (Phase 19 — contact emails)", () => {
  const phoneOnly = { phoneE164: "+64211234567", email: null };
  const account = { phoneE164: "+64211234567", email: "account@example.com" };

  it("prefers the email given for this visit, then the account email, then SMS", () => {
    expect(resolveChannel(account, "visit@example.com")).toEqual({
      channel: "EMAIL",
      recipient: "visit@example.com",
    });
    expect(resolveChannel(account)).toEqual({ channel: "EMAIL", recipient: "account@example.com" });
    expect(resolveChannel(phoneOnly, null)).toEqual({ channel: "SMS", recipient: "+64211234567" });
  });
});
