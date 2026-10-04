import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { Roles } from "../auth/roles.decorator";
import type { RequestUser } from "../auth/request-user.interface";
import { TenantLogoService } from "./tenant-logo.service";

/**
 * Upload/remove (owner/admin) and the public image itself (Phase 16).
 * Upload takes the raw image bytes as the request body (parsed by the
 * raw-body middleware AppModule registers for this route only), not
 * multipart — no file-upload library needed for one small image.
 */
@Controller()
export class TenantLogoController {
  constructor(private readonly logos: TenantLogoService) {}

  @Put("tenants/me/logo")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  upload(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.logos.set(user.tenantId, req.body);
  }

  @Delete("tenants/me/logo")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: RequestUser): Promise<void> {
    await this.logos.remove(user.tenantId);
  }

  /**
   * Public: customer pages, the TV board and emails show it. Cached for a
   * year — the URL carries ?v=<upload time>, so a new upload is a new URL.
   * `Cross-Origin-Resource-Policy: cross-origin` because helmet's default
   * (same-origin) would stop the web app, a different origin, from
   * displaying it.
   */
  @Public()
  @Get("public/tenants/:tenantId/logo")
  async get(@Param("tenantId") tenantId: string, @Res() res: Response): Promise<void> {
    const logo = await this.logos.get(tenantId);
    res
      .set({
        "Content-Type": logo.mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "X-Content-Type-Options": "nosniff",
      })
      .send(logo.data);
  }
}
