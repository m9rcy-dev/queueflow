import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export const MAX_LOGO_BYTES = 500 * 1024;

/**
 * Accepted formats, identified by their first bytes — never by the
 * declared Content-Type, which the uploader controls. SVG is deliberately
 * absent: it's XML that can carry script (ADR-015).
 */
const SIGNATURES: Array<{ mimeType: string; matches: (b: Buffer) => boolean }> = [
  {
    mimeType: "image/png",
    matches: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { mimeType: "image/jpeg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mimeType: "image/webp",
    matches: (b) =>
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

/** The image's real type from its bytes, or null if it isn't one we accept. */
export function detectImageType(data: Buffer): string | null {
  return SIGNATURES.find((signature) => signature.matches(data))?.mimeType ?? null;
}

/**
 * The public URL path for a tenant's logo, or null without one. The
 * `?v=` is the upload time, so the image can be cached forever and a new
 * upload is simply a new URL. Relative to the API origin — the web app
 * prefixes its API base URL.
 */
export function tenantLogoPath(
  tenantId: string,
  logo: { updatedAt: Date } | null | undefined,
): string | null {
  return logo ? `/public/tenants/${tenantId}/logo?v=${logo.updatedAt.getTime()}` : null;
}

/** The business logo (Phase 16, ADR-015), stored in Postgres — see the TenantLogo model for why. */
@Injectable()
export class TenantLogoService {
  constructor(private readonly prisma: PrismaService) {}

  async set(tenantId: string, data: unknown): Promise<{ logoPath: string }> {
    if (!Buffer.isBuffer(data) || data.length === 0) {
      throw new BadRequestException({
        code: "LOGO_INVALID",
        message: "Upload a PNG, JPEG or WebP image.",
      });
    }
    if (data.length > MAX_LOGO_BYTES) {
      throw new BadRequestException({
        code: "LOGO_TOO_LARGE",
        message: "The logo must be 500 KB or smaller.",
      });
    }
    const mimeType = detectImageType(data);
    if (!mimeType) {
      throw new BadRequestException({
        code: "LOGO_INVALID",
        message: "Upload a PNG, JPEG or WebP image.",
      });
    }
    // Prisma's Bytes type wants a plain ArrayBuffer-backed array, not a Buffer view.
    const bytes = new Uint8Array(data);
    const logo = await this.prisma.tenantLogo.upsert({
      where: { tenantId },
      create: { tenantId, data: bytes, mimeType },
      update: { data: bytes, mimeType },
      select: { updatedAt: true },
    });
    return { logoPath: tenantLogoPath(tenantId, logo)! };
  }

  async remove(tenantId: string): Promise<void> {
    await this.prisma.tenantLogo.deleteMany({ where: { tenantId } });
  }

  async get(tenantId: string): Promise<{ data: Buffer; mimeType: string }> {
    const logo = await this.prisma.tenantLogo.findUnique({ where: { tenantId } });
    if (!logo) {
      throw new NotFoundException({ code: "LOGO_NOT_FOUND", message: "No logo." });
    }
    return { data: Buffer.from(logo.data), mimeType: logo.mimeType };
  }
}
