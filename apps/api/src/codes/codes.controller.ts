import { Controller, Get, Param, Post } from "@nestjs/common";
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
  create(@CurrentUser() user: RequestUser, @Param("queueId") queueId: string) {
    return this.codesService.createForQueue(user.tenantId, queueId);
  }

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("queueId") queueId: string) {
    return this.codesService.listForQueue(user.tenantId, queueId);
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
