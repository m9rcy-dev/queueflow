import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import {
  customerLogoutSchema,
  customerRefreshTokenSchema,
  customerRequestLoginCodeSchema,
  customerSignupSchema,
  customerVerifyLoginCodeSchema,
  type CustomerLogoutInput,
  type CustomerRefreshTokenInput,
  type CustomerRequestLoginCodeInput,
  type CustomerSignupInput,
  type CustomerVerifyLoginCodeInput,
} from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Public } from "../auth/public.decorator";
import { CustomerAuthService } from "./customer-auth.service";

/** Self-service customer auth (Phase 9, D-09) — reached via a GENERAL "sign up here" code's landing page. All public: no session exists yet at any of these calls. */
@Controller("public/customers")
export class CustomerAuthController {
  constructor(private readonly customerAuthService: CustomerAuthService) {}

  @Public()
  @Post("signup")
  @HttpCode(HttpStatus.ACCEPTED)
  async signUp(
    @Body(new ZodValidationPipe(customerSignupSchema)) body: CustomerSignupInput,
  ): Promise<{ message: string }> {
    await this.customerAuthService.signUp(body);
    return { message: "Check your email for a login code to finish setting up your account." };
  }

  @Public()
  @Post("login/request")
  @HttpCode(HttpStatus.ACCEPTED)
  async requestLoginCode(
    @Body(new ZodValidationPipe(customerRequestLoginCodeSchema))
    body: CustomerRequestLoginCodeInput,
  ): Promise<{ message: string }> {
    await this.customerAuthService.requestLoginCode(body.tenantId, body.email);
    return { message: "If that email has an account, a login code has been sent." };
  }

  @Public()
  @Post("login/verify")
  verifyLoginCode(
    @Body(new ZodValidationPipe(customerVerifyLoginCodeSchema)) body: CustomerVerifyLoginCodeInput,
  ) {
    return this.customerAuthService.verifyLoginCode(body.tenantId, body.email, body.code);
  }

  @Public()
  @Post("refresh")
  refresh(
    @Body(new ZodValidationPipe(customerRefreshTokenSchema)) body: CustomerRefreshTokenInput,
  ) {
    return this.customerAuthService.refresh(body.refreshToken);
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body(new ZodValidationPipe(customerLogoutSchema)) body: CustomerLogoutInput,
  ): Promise<void> {
    await this.customerAuthService.logout(body.refreshToken);
  }
}
