import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import {
  businessSignupSchema,
  logoutSchema,
  refreshTokenSchema,
  selectTenantSchema,
  requestLoginCodeSchema,
  verifyInviteSchema,
  verifyLoginCodeSchema,
  type BusinessSignupInput,
  type LogoutInput,
  type RefreshTokenInput,
  type RequestLoginCodeInput,
  type SelectTenantInput,
  type VerifyInviteInput,
  type VerifyLoginCodeInput,
} from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { Public } from "./public.decorator";
import type { RequestUser } from "./request-user.interface";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("business-signup")
  @HttpCode(HttpStatus.ACCEPTED)
  async signUpBusiness(
    @Body(new ZodValidationPipe(businessSignupSchema)) body: BusinessSignupInput,
  ): Promise<{ message: string }> {
    await this.authService.signUpBusiness(body);
    return { message: "Check your email for a login code to finish setting up your business." };
  }

  @Public()
  @Post("login/request")
  @HttpCode(HttpStatus.ACCEPTED)
  async requestLoginCode(
    @Body(new ZodValidationPipe(requestLoginCodeSchema)) body: RequestLoginCodeInput,
  ): Promise<{ message: string }> {
    await this.authService.requestLoginCode(body.email);
    // Same response whether or not the email exists (G-05).
    return { message: "If that email has an account, a login code has been sent." };
  }

  @Public()
  @Post("login/verify")
  verifyLoginCode(@Body(new ZodValidationPipe(verifyLoginCodeSchema)) body: VerifyLoginCodeInput) {
    return this.authService.verifyLoginCode(body.email, body.code);
  }

  @Public()
  @Post("select-tenant")
  selectTenant(@Body(new ZodValidationPipe(selectTenantSchema)) body: SelectTenantInput) {
    return this.authService.selectTenant(body.pendingToken, body.tenantId);
  }

  @Public()
  @Post("refresh")
  refresh(@Body(new ZodValidationPipe(refreshTokenSchema)) body: RefreshTokenInput) {
    return this.authService.refresh(body.refreshToken);
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body(new ZodValidationPipe(logoutSchema)) body: LogoutInput): Promise<void> {
    await this.authService.logout(body.refreshToken);
  }

  @Get("me")
  me(@CurrentUser() user: RequestUser): RequestUser {
    return user;
  }

  @Public()
  @Post("invites/:token/request")
  @HttpCode(HttpStatus.ACCEPTED)
  async requestInviteCode(@Param("token") token: string): Promise<{ message: string }> {
    await this.authService.requestInviteCode(token);
    return { message: "Check your email for a code to accept this invitation." };
  }

  @Public()
  @Post("invites/:token/verify")
  acceptInvite(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(verifyInviteSchema)) body: VerifyInviteInput,
  ) {
    return this.authService.acceptInvite(token, body.code);
  }
}
