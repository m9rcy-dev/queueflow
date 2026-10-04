import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { CustomerAuthResponse, CustomerAuthTokens } from "@queueflow/types";
import type { CustomerSignupInput } from "@queueflow/validation";
import { PrismaService } from "../prisma/prisma.service";
import { TokenService } from "../auth/token.service";
import { EmailProvider } from "../notifications/email-provider";
import { CustomersService } from "../customers/customers.service";
import { AuthenticatorService } from "../authenticator/authenticator.service";
import { tenantLogoPath } from "../tenants/tenant-logo.service";

const MAX_VERIFY_ATTEMPTS = 5;

/** Same generic-failure principle as staff auth's invalidLoginCode() — never reveals whether the email, the code, or the tenant was wrong (G-05). */
function invalidLoginCode(): UnauthorizedException {
  return new UnauthorizedException({
    code: "INVALID_LOGIN_CODE",
    message: "That code is invalid or has expired.",
  });
}

/**
 * Customer login/session (Phase 9, D-09) — mirrors AuthService's proven
 * OTP + opaque-refresh-token mechanics exactly, but against the
 * Customer/CustomerLoginCode/CustomerRefreshToken tables instead of
 * User/LoginCode/RefreshToken, and with no tenant-selection step (a
 * customer account only ever belongs to the one tenant it was created
 * in — D-09 — so tenantId is always known up front, passed by the
 * caller rather than resolved after verification).
 */
@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly emailProvider: EmailProvider,
    private readonly customersService: CustomersService,
    private readonly authenticator: AuthenticatorService,
  ) {}

  /** Self-service signup via a GENERAL code (D-10) — creates the account, then sends a login code to prove the customer actually owns that inbox before any session is issued. */
  async signUp(input: CustomerSignupInput): Promise<void> {
    const customer = await this.customersService.signUp(input.tenantId, input);
    await this.issueAndSendLoginCode(customer.id, input.email);
  }

  /**
   * Deliberately silent if the email doesn't exist for this tenant (G-05) —
   * same response either way. No email for an authenticator-app account
   * unless `forceEmail` (Phase 15, ADR-014 — same rule as staff login).
   */
  async requestLoginCode(tenantId: string, email: string, forceEmail = false): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });
    if (!customer) return;
    if (!forceEmail && (await this.authenticator.isEnabled({ customerId: customer.id }))) return;
    await this.issueAndSendLoginCode(customer.id, email);
  }

  async verifyLoginCode(
    tenantId: string,
    email: string,
    submittedCode: string,
  ): Promise<CustomerAuthResponse> {
    const customer = await this.prisma.customer.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });
    if (!customer) {
      throw invalidLoginCode();
    }

    // Authenticator first, then the emailed code — same order and failure
    // counting as staff login (AuthService.verifyLoginCode, ADR-014).
    const owner = { customerId: customer.id };
    const authenticatorResult = await this.authenticator.check(owner, submittedCode);
    if (authenticatorResult !== "valid") {
      const emailCodeMatched = await this.consumeEmailedCode(customer.id, submittedCode);
      if (!emailCodeMatched) {
        if (authenticatorResult === "invalid") await this.authenticator.recordFailure(owner);
        throw invalidLoginCode();
      }
    }

    return this.issueSession(customer);
  }

  /** Authenticator setup step 1 — the app entry names the business, since a customer account belongs to one (D-09). */
  async beginAuthenticatorSetup(customerId: string) {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      include: { tenant: { select: { name: true } } },
    });
    return this.authenticator.beginSetup(
      { customerId },
      `QueueFlow (${customer.tenant.name})`,
      customer.email ?? customer.phoneE164,
    );
  }

  private async consumeEmailedCode(customerId: string, submittedCode: string): Promise<boolean> {
    const latestCode = await this.prisma.customerLoginCode.findFirst({
      where: { customerId, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!latestCode || latestCode.attempts >= MAX_VERIFY_ATTEMPTS) {
      return false;
    }
    if (this.tokenService.hashLoginCode(submittedCode) !== latestCode.codeHash) {
      await this.prisma.customerLoginCode.update({
        where: { id: latestCode.id },
        data: { attempts: { increment: 1 } },
      });
      return false;
    }
    await this.prisma.customerLoginCode.update({
      where: { id: latestCode.id },
      data: { consumedAt: new Date() },
    });
    return true;
  }

  async refresh(refreshToken: string): Promise<CustomerAuthTokens> {
    const tokenHash = this.tokenService.hashRefreshToken(refreshToken);
    const stored = await this.prisma.customerRefreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException({
        code: "INVALID_REFRESH_TOKEN",
        message: "Your session has expired. Please log in again.",
      });
    }

    const customer = await this.prisma.customer.findUnique({ where: { id: stored.customerId } });
    if (!customer) {
      throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "Account not found." });
    }

    // Rotate: revoke the old token, issue a new one (ADR-004), same pattern as staff refresh.
    const generated = this.tokenService.generateRefreshToken();
    await this.prisma.$transaction([
      this.prisma.customerRefreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.customerRefreshToken.create({
        data: {
          customerId: customer.id,
          tokenHash: generated.tokenHash,
          expiresAt: generated.expiresAt,
        },
      }),
    ]);

    const accessToken = this.tokenService.generateCustomerAccessToken({
      sub: customer.id,
      tenantId: customer.tenantId,
      type: "customer",
    });
    return { accessToken, refreshToken: generated.token };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.tokenService.hashRefreshToken(refreshToken);
    await this.prisma.customerRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueAndSendLoginCode(customerId: string, email: string): Promise<void> {
    const { code, codeHash, expiresAt } = this.tokenService.generateLoginCode();
    // Invalidate any still-valid earlier codes first — only the most recent code should ever verify (same as staff auth).
    await this.prisma.customerLoginCode.updateMany({
      where: { customerId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await this.prisma.customerLoginCode.create({ data: { customerId, codeHash, expiresAt } });
    await this.emailProvider.send({
      to: email,
      subject: "Your QueueFlow login code",
      body: `Your login code is ${code}. It expires in 10 minutes.`,
    });
  }

  private async issueSession(customer: {
    id: string;
    tenantId: string;
    firstName: string | null;
    phoneE164: string;
    email: string | null;
  }): Promise<CustomerAuthResponse> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: customer.tenantId },
      include: { logo: { select: { updatedAt: true } } },
    });

    const accessToken = this.tokenService.generateCustomerAccessToken({
      sub: customer.id,
      tenantId: customer.tenantId,
      type: "customer",
    });
    const generatedRefresh = this.tokenService.generateRefreshToken();
    await this.prisma.customerRefreshToken.create({
      data: {
        customerId: customer.id,
        tokenHash: generatedRefresh.tokenHash,
        expiresAt: generatedRefresh.expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: generatedRefresh.token,
      customer: {
        id: customer.id,
        firstName: customer.firstName,
        phoneE164: customer.phoneE164,
        email: customer.email,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        logoPath: tenantLogoPath(tenant.id, tenant.logo),
      },
    };
  }
}
