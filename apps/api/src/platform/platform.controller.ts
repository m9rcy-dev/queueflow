import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  requestLoginCodeSchema,
  verifyLoginCodeSchema,
  type RequestLoginCodeInput,
  type VerifyLoginCodeInput,
} from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Public } from "../auth/public.decorator";
import { AuthService } from "../auth/auth.service";
import { PlatformAdminGuard, type PlatformRequest } from "./platform-admin.guard";
import { PlatformService } from "./platform.service";

/**
 * QueueFlow's own operators (Phase 19, ADR-018). Every route is @Public()
 * to the staff JwtAuthGuard; the data routes use PlatformAdminGuard.
 */
@Public()
@Controller("platform")
export class PlatformController {
  constructor(
    private readonly auth: AuthService,
    private readonly platform: PlatformService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login/request")
  @HttpCode(HttpStatus.ACCEPTED)
  async requestCode(
    @Body(new ZodValidationPipe(requestLoginCodeSchema)) body: RequestLoginCodeInput,
  ): Promise<{ message: string }> {
    await this.auth.requestPlatformLoginCode(body.email);
    // The same answer for everyone — never reveals who the admins are.
    return { message: "If that email is a QueueFlow admin, a login code has been sent." };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("login/verify")
  verify(@Body(new ZodValidationPipe(verifyLoginCodeSchema)) body: VerifyLoginCodeInput) {
    return this.auth.verifyPlatformLogin(body.email, body.code);
  }

  @UseGuards(PlatformAdminGuard)
  @Get("me")
  me(@Req() request: PlatformRequest) {
    return { email: request.platformAdmin?.email };
  }

  @UseGuards(PlatformAdminGuard)
  @Get("tenants")
  listTenants() {
    return this.platform.listTenants();
  }

  @UseGuards(PlatformAdminGuard)
  @Get("tenants/:id")
  getTenant(@Param("id") id: string) {
    return this.platform.getTenant(id);
  }
}
