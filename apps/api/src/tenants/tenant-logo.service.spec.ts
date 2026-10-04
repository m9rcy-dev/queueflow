import { BadRequestException } from "@nestjs/common";
import {
  detectImageType,
  MAX_LOGO_BYTES,
  TenantLogoService,
  tenantLogoPath,
} from "./tenant-logo.service";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe("logo validation (Phase 16)", () => {
  it("recognises PNG, JPEG and WebP by their bytes", () => {
    expect(detectImageType(PNG)).toBe("image/png");
    expect(detectImageType(JPEG)).toBe("image/jpeg");
    expect(detectImageType(WEBP)).toBe("image/webp");
  });

  it("rejects SVG and anything else, whatever it claims to be", () => {
    expect(detectImageType(SVG)).toBeNull();
    expect(detectImageType(Buffer.from("GIF89a"))).toBeNull();
  });

  it("refuses oversized, empty, and non-image uploads before touching the database", async () => {
    const prisma = { tenantLogo: { upsert: jest.fn() } };
    const service = new TenantLogoService(prisma as never);
    const tooBig = Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES)]);
    await expect(service.set("t1", tooBig)).rejects.toMatchObject({
      response: { code: "LOGO_TOO_LARGE" },
    });
    await expect(service.set("t1", Buffer.alloc(0))).rejects.toThrow(BadRequestException);
    await expect(service.set("t1", SVG)).rejects.toMatchObject({
      response: { code: "LOGO_INVALID" },
    });
    await expect(service.set("t1", { not: "a buffer" })).rejects.toThrow(BadRequestException);
    expect(prisma.tenantLogo.upsert).not.toHaveBeenCalled();
  });

  it("builds a cache-busting path from the upload time", () => {
    expect(tenantLogoPath("t1", { updatedAt: new Date(1234) })).toBe(
      "/public/tenants/t1/logo?v=1234",
    );
    expect(tenantLogoPath("t1", null)).toBeNull();
  });
});
