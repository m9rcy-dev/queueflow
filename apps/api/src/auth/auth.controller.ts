import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  businessSignupSchema,
  confirmAuthenticatorSchema,
  type ConfirmAuthenticatorInput,
  deviceContextSchema,
  logoutSchema,
  refreshTokenSchema,
  selectTenantSchema,
  requestLoginCodeSchema,
  setPinSchema,
  staffPinLoginSchema,
  verifyInviteSchema,
  verifyLoginCodeSchema,
  type BusinessSignupInput,
  type DeviceContextInput,
  type LogoutInput,
  type RefreshTokenInput,
  type RequestLoginCodeInput,
  type SelectTenantInput,
  type SetPinInput,
  type StaffPinLoginInput,
  type VerifyInviteInput,
  type VerifyLoginCodeInput,
} from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthenticatorService } from "../authenticator/authenticator.service";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { Public } from "./public.decorator";
import type { RequestUser } from "./request-user.interface";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authenticator: AuthenticatorService,
  ) {}

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
    await this.authService.requestLoginCode(body.email, body.forceEmail);
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

  // --- Authenticator app login (Phase 15, ADR-014). Per person, not per
  // business: a staff User's login spans every tenant they belong to. ---

  @Get("me/authenticator")
  authenticatorStatus(@CurrentUser() user: RequestUser) {
    return this.authenticator.getStatus({ userId: user.userId });
  }

  @Post("me/authenticator/setup")
  beginAuthenticatorSetup(@CurrentUser() user: RequestUser) {
    return this.authService.beginAuthenticatorSetup(user.userId);
  }

  @Post("me/authenticator/confirm")
  confirmAuthenticator(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(confirmAuthenticatorSchema)) body: ConfirmAuthenticatorInput,
  ) {
    return this.authenticator.confirmSetup({ userId: user.userId }, body.code);
  }

  @Delete("me/authenticator")
  disableAuthenticator(@CurrentUser() user: RequestUser) {
    return this.authenticator.disable({ userId: user.userId });
  }

  /** "Trust this device" (D-03a) — an already-logged-in staff member opts a shared counter tablet into PIN switching. */
  @Post("devices/trust")
  trustDevice(@CurrentUser() user: RequestUser) {
    return this.authService.trustDevice(user.tenantId);
  }

  /** Presented with a trusted device's token, returns who can PIN-switch in on it (D-03a). Public — no session exists yet at this point. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("device-context")
  deviceContext(@Body(new ZodValidationPipe(deviceContextSchema)) body: DeviceContextInput) {
    return this.authService.getDeviceContext(body.deviceTrustToken);
  }

  /** Second half of shift-change switching — a staff member's PIN, checked against a trusted device (D-03a). */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("staff-pin-login")
  staffPinLogin(@Body(new ZodValidationPipe(staffPinLoginSchema)) body: StaffPinLoginInput) {
    return this.authService.staffPinLogin(body.deviceTrustToken, body.tenantUserId, body.pin);
  }

  /** Sets/changes the current staff member's own PIN for quick device switching (D-03a). */
  @Post("pin")
  @HttpCode(HttpStatus.NO_CONTENT)
  async setPin(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(setPinSchema)) body: SetPinInput,
  ): Promise<void> {
    await this.authService.setPin(user.tenantUserId, body.pin);
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
