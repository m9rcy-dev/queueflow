import { BadRequestException } from "@nestjs/common";
import { normalizePhoneToE164 } from "./phone.util";

describe("normalizePhoneToE164", () => {
  it("converts an NZ local mobile number to E.164", () => {
    expect(normalizePhoneToE164("0211234567")).toBe("+64211234567");
  });

  it("strips spaces and dashes before normalizing", () => {
    expect(normalizePhoneToE164("021 123 4567")).toBe("+64211234567");
    expect(normalizePhoneToE164("021-123-4567")).toBe("+64211234567");
  });

  it("passes through an already-international number unchanged (trimmed)", () => {
    expect(normalizePhoneToE164("+61 4 1234 5678")).toBe("+61412345678");
  });

  it("rejects garbage input", () => {
    expect(() => normalizePhoneToE164("not a phone number")).toThrow(BadRequestException);
    expect(() => normalizePhoneToE164("123")).toThrow(BadRequestException);
  });

  it("two different customers typing the same number differently normalize identically (this is what makes G-34's dedup work)", () => {
    expect(normalizePhoneToE164("0211234567")).toBe(normalizePhoneToE164("021 123 4567"));
  });
});
