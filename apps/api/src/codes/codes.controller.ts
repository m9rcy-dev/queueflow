import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { createCodeSchema, type CreateCodeInput } from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Public } from "../auth/public.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { RequestUser } from "../auth/request-user.interface";
import { CodesService } from "./codes.service";

@Controller("tenants/me/queues/:queueId/codes")
export class QueueCodesController {
  constructor(private readonly codesService: CodesService) {}

  @Post()
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  create(
    @CurrentUser() user: RequestUser,
    @Param("queueId") queueId: string,
    @Body(new ZodValidationPipe(createCodeSchema)) body: CreateCodeInput,
  ) {
    return this.codesService.createForQueue(user.tenantId, queueId, body.contextType);
  }

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("queueId") queueId: string) {
    return this.codesService.listForQueue(user.tenantId, queueId);
  }

  @Post(":codeId/deactivate")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(
    @CurrentUser() user: RequestUser,
    @Param("queueId") queueId: string,
    @Param("codeId") codeId: string,
  ): Promise<void> {
    await this.codesService.deactivate(user.tenantId, queueId, codeId);
  }
}

@Controller("public/codes")
export class PublicCodesController {
  constructor(private readonly codesService: CodesService) {}

  @Public()
  @Get(":code")
  resolve(@Param("code") code: string) {
    return this.codesService.resolve(code);
  }
}
