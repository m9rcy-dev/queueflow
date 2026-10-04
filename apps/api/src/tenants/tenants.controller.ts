import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  createInviteSchema,
  updateCapabilitiesSchema,
  updateMemberSchema,
  type CreateInviteInput,
  type UpdateCapabilitiesInput,
  type UpdateMemberInput,
} from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { RequestUser } from "../auth/request-user.interface";
import { TenantsService } from "./tenants.service";

/**
 * All routes here operate on "my tenant" — the tenantId comes from the
 * authenticated request (CurrentUser), never from the URL or body, so
 * there's no way to address another tenant's data through this controller
 * at all (stronger than a runtime check — the shape of the API prevents it).
 */
@Controller("tenants/me")
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  getTenant(@CurrentUser() user: RequestUser) {
    return this.tenantsService.getTenant(user.tenantId);
  }

  @Patch("capabilities")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  updateCapabilities(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateCapabilitiesSchema)) body: UpdateCapabilitiesInput,
  ) {
    return this.tenantsService.updateCapabilities(user.tenantId, body);
  }

  @Get("staff")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  listStaff(@CurrentUser() user: RequestUser) {
    return this.tenantsService.listMembers(user.tenantId);
  }

  /** Phase 16 — change a member's role and/or location (ADR-015). */
  @Patch("staff/:id")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  updateMember(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateMemberSchema)) body: UpdateMemberInput,
  ) {
    return this.tenantsService.updateMember(user.tenantId, user.tenantUserId, id, body);
  }

  /** Phase 16 — remove a member (soft; they're signed out everywhere at once). */
  @Delete("staff/:id")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(@CurrentUser() user: RequestUser, @Param("id") id: string): Promise<void> {
    await this.tenantsService.removeMember(user.tenantId, user.tenantUserId, id);
  }

  @Post("invites")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  createInvite(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createInviteSchema)) body: CreateInviteInput,
  ) {
    return this.tenantsService.createInvite(user.tenantId, body);
  }

  @Get("invites")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  listInvites(@CurrentUser() user: RequestUser) {
    return this.tenantsService.listInvites(user.tenantId);
  }

  @Delete("invites/:id")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvite(@CurrentUser() user: RequestUser, @Param("id") id: string): Promise<void> {
    await this.tenantsService.revokeInvite(user.tenantId, id);
  }
}
