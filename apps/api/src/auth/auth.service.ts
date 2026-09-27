import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  AuthTokens,
  LoginVerifyResponse,
  MembershipSummary,
  TenantSummary,
} from "@queueflow/types";
import type { BusinessSignupInput } from "@queueflow/validation";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { TokenService } from "./token.service";

const MAX_VERIFY_ATTEMPTS = 5;

function invalidInviteCode(): UnauthorizedException {
  return new UnauthorizedException({
    code: "INVALID_INVITE_CODE",
    message: "That code is invalid or has expired.",
  });
}

function invalidOrExpiredInvite(): NotFoundException {
  // Same response for "doesn't exist", "expired", "revoked", and "already
  // accepted" — an invite token is a bearer secret, so no reason to
  // distinguish these states to whoever is holding an invalid one.
  return new NotFoundException({
    code: "INVITE_NOT_FOUND",
    message: "This invitation is invalid or has expired.",
  });
}

function invalidLoginCode(): UnauthorizedException {
  // Same message whether the email doesn't exist, the code is wrong, or the
  // code expired — no signal that lets a caller distinguish these (G-05).
  return new UnauthorizedException({
    code: "INVALID_LOGIN_CODE",
    message: "That code is invalid or has expired.",
  });
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Business signup (G-01) — a separate entry point from customer signup,
   * not an auto-detected "unknown email" branch of login. Creates the
   * tenant, the owner's user record, and the OWNER membership atomically,
   * then sends a login code to verify the email. Does not itself log
   * anyone in — the client calls verifyLoginCode next.
   */
  async signUpBusiness(input: BusinessSignupInput): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException({
        code: "EMAIL_ALREADY_REGISTERED",
        message: "This email is already registered. Sign in instead, or use a different email.",
      });
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: { email: input.email, displayName: input.ownerName },
      });
      const tenant = await tx.tenant.create({
        data: { name: input.businessName, ownerName: input.ownerName },
      });
      await tx.tenantUser.create({
        data: { tenantId: tenant.id, userId: createdUser.id, role: "TENANT_OWNER" },
      });
      return createdUser;
    });

    await this.issueAndSendLoginCode(user.id, user.email);
  }

  /**
   * Requests a login code for an existing user. Deliberately silent (no
   * error, no distinguishing response) if the email doesn't exist — sending
   * nothing is fine, since there's no user to notify, but the caller can't
   * tell the difference (G-05).
   */
  async requestLoginCode(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return;
    }
    await this.issueAndSendLoginCode(user.id, user.email);
  }

  async verifyLoginCode(email: string, submittedCode: string): Promise<LoginVerifyResponse> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw invalidLoginCode();
    }

    const latestCode = await this.prisma.loginCode.findFirst({
      where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!latestCode || latestCode.attempts >= MAX_VERIFY_ATTEMPTS) {
      throw invalidLoginCode();
    }

    const submittedHash = this.tokenService.hashLoginCode(submittedCode);
    if (submittedHash !== latestCode.codeHash) {
      await this.prisma.loginCode.update({
        where: { id: latestCode.id },
        data: { attempts: { increment: 1 } },
      });
      throw invalidLoginCode();
    }

    await this.prisma.loginCode.update({
      where: { id: latestCode.id },
      data: { consumedAt: new Date() },
    });
    if (!user.emailVerifiedAt) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }

    const memberships = await this.prisma.tenantUser.findMany({
      where: { userId: user.id },
      include: { tenant: true },
      orderBy: { createdAt: "asc" },
    });

    if (memberships.length === 0) {
      throw new ForbiddenException({
        code: "NO_TENANT_ACCESS",
        message: "This account has no business access. Contact your business owner for an invite.",
      });
    }

    if (memberships.length > 1) {
      return {
        requiresTenantSelection: true,
        pendingToken: this.tokenService.generatePendingToken(user.id),
        tenants: memberships.map(toMembershipSummary),
      };
    }

    const [membership] = memberships;
    return this.issueSession(user, membership.tenant, membership.role);
  }

  /** Second step when verifyLoginCode returned requiresTenantSelection. */
  async selectTenant(pendingToken: string, tenantId: string) {
    const { sub: userId } = this.tokenService.verifyPendingToken(pendingToken);

    const membership = await this.prisma.tenantUser.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: { tenant: true, user: true },
    });
    if (!membership) {
      throw new ForbiddenException({
        code: "NO_TENANT_ACCESS",
        message: "You do not have access to that business.",
      });
    }

    return this.issueSession(membership.user, membership.tenant, membership.role);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = this.tokenService.hashRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException({
        code: "INVALID_REFRESH_TOKEN",
        message: "Your session has expired. Please log in again.",
      });
    }

    // Re-check the membership's *current* role rather than trusting
    // whatever was true when the refresh token was first issued.
    const membership = await this.prisma.tenantUser.findUnique({
      where: { tenantId_userId: { tenantId: stored.tenantId, userId: stored.userId } },
    });
    if (!membership) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException({
        code: "MEMBERSHIP_REVOKED",
        message: "Your access to this business has been revoked.",
      });
    }

    // Rotate: revoke the old token, issue a new one (ADR-004).
    const generated = this.tokenService.generateRefreshToken();
    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: stored.userId,
          tenantId: stored.tenantId,
          tokenHash: generated.tokenHash,
          expiresAt: generated.expiresAt,
        },
      }),
    ]);

    const accessToken = this.tokenService.generateAccessToken({
      sub: stored.userId,
      tenantId: stored.tenantId,
      role: membership.role,
    });
    return { accessToken, refreshToken: generated.token };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.tokenService.hashRefreshToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Staff invite acceptance, step 1 (G-02) — sends a code to the invite's
   * own stored email, not whatever email the caller supplies, so the
   * invite token itself is the only thing that determines who this can go
   * to.
   */
  async requestInviteCode(token: string): Promise<void> {
    const invite = await this.findAcceptableInvite(token);
    // The OTP lives on the invite row itself, not the LoginCode table — an
    // invitee may not have a User yet at this point (acceptInvite creates
    // one), so there's nothing to attach a LoginCode to until acceptance.
    const { code, codeHash, expiresAt } = this.tokenService.generateLoginCode();
    await this.prisma.tenantInvite.update({
      where: { id: invite.id },
      data: { codeHash, codeExpiresAt: expiresAt, codeAttempts: 0 },
    });
    await this.mailService.sendInviteCode(invite.email, code, invite.tenant.name);
  }

  /** Staff invite acceptance, step 2 — verifies the code, creates the membership. */
  async acceptInvite(token: string, submittedCode: string) {
    const invite = await this.findAcceptableInvite(token);
    if (!invite.codeHash || !invite.codeExpiresAt || invite.codeExpiresAt < new Date()) {
      throw invalidInviteCode();
    }
    if (invite.codeAttempts >= MAX_VERIFY_ATTEMPTS) {
      throw invalidInviteCode();
    }
    if (this.tokenService.hashLoginCode(submittedCode) !== invite.codeHash) {
      await this.prisma.tenantInvite.update({
        where: { id: invite.id },
        data: { codeAttempts: { increment: 1 } },
      });
      throw invalidInviteCode();
    }

    const { user, membership } = await this.prisma.$transaction(async (tx) => {
      let existingUser = await tx.user.findUnique({ where: { email: invite.email } });
      if (!existingUser) {
        existingUser = await tx.user.create({
          data: { email: invite.email, displayName: invite.email, emailVerifiedAt: new Date() },
        });
      } else if (!existingUser.emailVerifiedAt) {
        existingUser = await tx.user.update({
          where: { id: existingUser.id },
          data: { emailVerifiedAt: new Date() },
        });
      }

      const createdMembership = await tx.tenantUser.upsert({
        where: { tenantId_userId: { tenantId: invite.tenantId, userId: existingUser.id } },
        create: { tenantId: invite.tenantId, userId: existingUser.id, role: invite.role },
        update: { role: invite.role },
      });

      await tx.tenantInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });

      return { user: existingUser, membership: createdMembership };
    });

    return this.issueSession(user, invite.tenant, membership.role);
  }

  private async findAcceptableInvite(token: string) {
    const invite = await this.prisma.tenantInvite.findUnique({
      where: { token },
      include: { tenant: true },
    });
    if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt < new Date()) {
      throw invalidOrExpiredInvite();
    }
    return invite;
  }

  private async issueAndSendLoginCode(userId: string, email: string): Promise<void> {
    const { code, codeHash, expiresAt } = this.tokenService.generateLoginCode();
    // Invalidate any still-valid earlier codes for this user first — only
    // the most recent code should ever verify successfully.
    await this.prisma.loginCode.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await this.prisma.loginCode.create({ data: { userId, codeHash, expiresAt } });
    await this.mailService.sendLoginCode(email, code);
  }

  private async issueSession(
    user: { id: string; email: string; displayName: string },
    tenant: {
      id: string;
      name: string;
      ownerName: string;
      queueEnabled: boolean;
      appointmentEnabled: boolean;
    },
    role: MembershipSummary["role"],
  ) {
    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      tenantId: tenant.id,
      role,
    });
    const generatedRefresh = this.tokenService.generateRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        tokenHash: generatedRefresh.tokenHash,
        expiresAt: generatedRefresh.expiresAt,
      },
    });

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    };
    const tenantSummary: TenantSummary = {
      id: tenant.id,
      name: tenant.name,
      ownerName: tenant.ownerName,
      queueEnabled: tenant.queueEnabled,
      appointmentEnabled: tenant.appointmentEnabled,
    };

    return {
      requiresTenantSelection: false as const,
      accessToken,
      refreshToken: generatedRefresh.token,
      user: authenticatedUser,
      tenant: tenantSummary,
      role,
    };
  }
}

function toMembershipSummary(membership: {
  tenantId: string;
  role: MembershipSummary["role"];
  tenant: { name: string };
}): MembershipSummary {
  return {
    tenantId: membership.tenantId,
    tenantName: membership.tenant.name,
    role: membership.role,
  };
}
