import { Prisma } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  AuthTokens,
  AuthSuccessResponse,
  DeviceContextResponse,
  InviteDetails,
  StaffProfile,
  LoginVerifyResponse,
  MembershipSummary,
  TenantSummary,
  TrustDeviceResponse,
} from "@queueflow/types";
import type { BusinessSignupInput } from "@queueflow/validation";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { PinService } from "./pin.service";
import { TokenService } from "./token.service";
import type { RequestUser } from "./request-user.interface";
import { AuthenticatorService } from "../authenticator/authenticator.service";
import { tenantLogoPath } from "../tenants/tenant-logo.service";

const MAX_VERIFY_ATTEMPTS = 5;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_MINUTES = 15;

/** Same generic-failure principle as invalidLoginCode() — never reveals whether the device, the staff member, or the PIN itself was wrong. */
function invalidPin(): UnauthorizedException {
  return new UnauthorizedException({
    code: "INVALID_PIN",
    message:
      "Incorrect PIN, or this device isn't recognized. Please try again or sign in normally.",
  });
}

function invalidDeviceTrust(): UnauthorizedException {
  return new UnauthorizedException({
    code: "INVALID_DEVICE_TRUST",
    message: "This device is no longer trusted. Please sign in normally.",
  });
}

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
    private readonly pinService: PinService,
    private readonly authenticator: AuthenticatorService,
    private readonly configService: ConfigService,
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
   *
   * Phase 15 (ADR-014): no email is sent when the account logs in with an
   * authenticator app — unless `forceEmail` ("Email me a code instead"),
   * which is always honoured, so a lost phone never locks anyone out. The
   * response is identical either way.
   */
  async requestLoginCode(email: string, forceEmail = false): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return;
    }
    if (!forceEmail && (await this.authenticator.isEnabled({ userId: user.id }))) {
      return;
    }
    await this.issueAndSendLoginCode(user.id, user.email);
  }

  /**
   * One code box, two kinds of code (Phase 15, ADR-014): the authenticator
   * is checked first, then the latest emailed code. Checking in that order
   * means typing authenticator codes never burns the emailed code's
   * attempts; an authenticator failure is only counted once the emailed
   * code didn't match either.
   */
  async verifyLoginCode(email: string, submittedCode: string): Promise<LoginVerifyResponse> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw invalidLoginCode();
    }

    const owner = { userId: user.id };
    const authenticatorResult = await this.authenticator.check(owner, submittedCode);
    if (authenticatorResult !== "valid") {
      const emailCodeMatched = await this.consumeEmailedCode(user.id, submittedCode);
      if (!emailCodeMatched) {
        if (authenticatorResult === "invalid") await this.authenticator.recordFailure(owner);
        throw invalidLoginCode();
      }
    }

    if (!user.emailVerifiedAt) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }

    const memberships = await this.prisma.tenantUser.findMany({
      where: { userId: user.id, removedAt: null },
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

  /**
   * Platform (root) sign-in, step 1 (Phase 19, ADR-018). Only emails in
   * PLATFORM_ADMIN_EMAILS get a code; anyone else gets the same silent
   * 202, so the endpoint never reveals who the admins are. An allow-listed
   * email with no account yet gets one (they need no business).
   */
  async requestPlatformLoginCode(email: string): Promise<void> {
    if (!isPlatformAdminEmail(this.configService.get<string>("PLATFORM_ADMIN_EMAILS"), email)) {
      return;
    }
    const user = await this.prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, displayName: "QueueFlow admin" },
    });
    await this.issueAndSendLoginCode(user.id, user.email);
  }

  /** Platform sign-in, step 2 — an emailed or authenticator code, as for staff (ADR-014). */
  async verifyPlatformLogin(email: string, submittedCode: string) {
    if (!isPlatformAdminEmail(this.configService.get<string>("PLATFORM_ADMIN_EMAILS"), email)) {
      throw invalidLoginCode();
    }
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw invalidLoginCode();
    const owner = { userId: user.id };
    const authenticatorResult = await this.authenticator.check(owner, submittedCode);
    if (authenticatorResult !== "valid") {
      const emailCodeMatched = await this.consumeEmailedCode(user.id, submittedCode);
      if (!emailCodeMatched) {
        if (authenticatorResult === "invalid") await this.authenticator.recordFailure(owner);
        throw invalidLoginCode();
      }
    }
    return {
      accessToken: this.tokenService.generatePlatformToken(user.id, user.email),
      admin: { email: user.email, displayName: user.displayName },
    };
  }

  /** Second step when verifyLoginCode returned requiresTenantSelection. */
  async selectTenant(pendingToken: string, tenantId: string) {
    const { sub: userId } = this.tokenService.verifyPendingToken(pendingToken);

    const membership = await this.prisma.tenantUser.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: { tenant: true, user: true },
    });
    if (!membership || membership.removedAt) {
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
    if (!membership || membership.removedAt) {
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

  /**
   * "The tablet trusts once" (D-03a) — an already-authenticated staff
   * member opts a shared counter device into skipping straight to PIN
   * switching next time. Not tied to this one user: any staff member of
   * the tablet's location can PIN-switch in on it.
   *
   * Phase 16 (ADR-015): the tablet belongs to one location — a location-
   * bound member's own; otherwise the one requested (the dashboard sends
   * its queue's location); otherwise the business's only location. A
   * multi-location owner/admin who names none gets LOCATION_REQUIRED.
   */
  async trustDevice(
    user: { tenantId: string; locationId: string | null },
    requestedLocationId?: string,
  ): Promise<TrustDeviceResponse> {
    const locationId = await this.resolveTabletLocation(user, requestedLocationId);
    const generated = this.tokenService.generateDeviceTrustToken();
    await this.prisma.deviceTrust.create({
      data: {
        tenantId: user.tenantId,
        locationId,
        tokenHash: generated.tokenHash,
        expiresAt: generated.expiresAt,
      },
    });
    return { deviceTrustToken: generated.token, expiresAt: generated.expiresAt.toISOString() };
  }

  /**
   * "Who can sign in on this device?" — presented with a trusted device's
   * token, returns the tenant's staff roster so the client can render a
   * name-picker before asking for a PIN. Rotates the trust token on every
   * call (ADR-004's rotation pattern) since presenting it is a genuine use.
   */
  async getDeviceContext(deviceTrustToken: string): Promise<DeviceContextResponse> {
    const trust = await this.findActiveDeviceTrust(deviceTrustToken);
    const rotatedToken = await this.rotateDeviceTrust(trust);

    const [tenant, location, memberships] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: trust.tenantId },
        include: { logo: { select: { updatedAt: true } } },
      }),
      trust.locationId
        ? this.prisma.location.findUnique({
            where: { id: trust.locationId },
            select: { id: true, name: true },
          })
        : null,
      this.prisma.tenantUser.findMany({
        where: {
          tenantId: trust.tenantId,
          removedAt: null,
          ...tabletStaffFilter(trust.locationId),
        },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    return {
      deviceTrustToken: rotatedToken,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        logoPath: tenantLogoPath(tenant.id, tenant.logo),
      },
      location,
      staff: memberships.map((membership) => ({
        tenantUserId: membership.id,
        displayName: membership.user.displayName,
        role: membership.role,
        hasPin: membership.pinHash !== null,
      })),
    };
  }

  /**
   * Second half of shift-change switching: a staff member picked their
   * name off a trusted device and enters their PIN. Every queue action
   * this session performs will attribute to the returned tenantUserId
   * (G-18), same as a normal OTP login.
   */
  async staffPinLogin(
    deviceTrustToken: string,
    tenantUserId: string,
    pin: string,
  ): Promise<AuthSuccessResponse> {
    const trust = await this.findActiveDeviceTrust(deviceTrustToken);

    const membership = await this.prisma.tenantUser.findUnique({
      where: { id: tenantUserId },
      include: { user: true, tenant: true },
    });
    // The membership must belong to the SAME tenant this device is trusted
    // for — a device trusted for Tenant A must never authenticate someone
    // as Tenant B's staff, even if they somehow know a valid tenantUserId.
    if (
      !membership ||
      membership.tenantId !== trust.tenantId ||
      membership.removedAt ||
      !canUseTablet(membership, trust.locationId)
    ) {
      throw invalidPin();
    }
    if (membership.pinLockedUntil && membership.pinLockedUntil > new Date()) {
      throw invalidPin();
    }
    if (!membership.pinHash || !(await this.pinService.verify(membership.pinHash, pin))) {
      await this.recordFailedPinAttempt(membership.id, membership.pinFailedAttempts);
      throw invalidPin();
    }

    await this.prisma.tenantUser.update({
      where: { id: membership.id },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });

    return this.issueSession(membership.user, membership.tenant, membership.role);
  }

  /**
   * A staff member sets/changes their own PIN for the tenant they're
   * currently authenticated into — always via a normal (OTP or existing
   * session) login first, never via the device-trust path itself.
   */
  async setPin(tenantUserId: string, pin: string): Promise<void> {
    const pinHash = await this.pinService.hash(pin);
    await this.prisma.tenantUser.update({
      where: { id: tenantUserId },
      data: { pinHash, pinFailedAttempts: 0, pinLockedUntil: null },
    });
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

  /** For the invite-acceptance page (Phase 16): who's inviting, and as what. The token is the credential, as for every invite step. */
  async getInviteDetails(token: string): Promise<InviteDetails> {
    const invite = await this.findAcceptableInvite(token);
    const location = invite.locationId
      ? await this.prisma.location.findUnique({ where: { id: invite.locationId } })
      : null;
    return {
      tenantName: invite.tenant.name,
      email: invite.email,
      role: invite.role,
      locationName: location?.name ?? null,
    };
  }

  /**
   * Staff invite acceptance, step 2 — verifies the code, creates the
   * membership (or reactivates a removed one, Phase 16) with the invite's
   * role and location. `displayName` names a newly created person; an
   * existing user keeps theirs unless it was still just their email.
   */
  async acceptInvite(token: string, submittedCode: string, displayName?: string) {
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
          data: {
            email: invite.email,
            displayName: displayName ?? invite.email,
            emailVerifiedAt: new Date(),
          },
        });
      } else if (
        !existingUser.emailVerifiedAt ||
        (displayName && existingUser.displayName === existingUser.email)
      ) {
        existingUser = await tx.user.update({
          where: { id: existingUser.id },
          data: {
            emailVerifiedAt: existingUser.emailVerifiedAt ?? new Date(),
            ...(displayName && existingUser.displayName === existingUser.email && { displayName }),
          },
        });
      }

      const createdMembership = await tx.tenantUser.upsert({
        where: { tenantId_userId: { tenantId: invite.tenantId, userId: existingUser.id } },
        create: {
          tenantId: invite.tenantId,
          userId: existingUser.id,
          role: invite.role,
          locationId: invite.locationId,
        },
        update: { role: invite.role, locationId: invite.locationId, removedAt: null },
      });

      await tx.tenantInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });

      return { user: existingUser, membership: createdMembership };
    });

    return this.issueSession(user, invite.tenant, membership.role);
  }

  private async resolveTabletLocation(
    user: { tenantId: string; locationId: string | null },
    requestedLocationId?: string,
  ): Promise<string> {
    if (user.locationId) return user.locationId;
    if (requestedLocationId) {
      const location = await this.prisma.location.findFirst({
        where: { id: requestedLocationId, tenantId: user.tenantId },
      });
      if (!location) {
        throw new NotFoundException({ code: "LOCATION_NOT_FOUND", message: "Location not found." });
      }
      return location.id;
    }
    const locations = await this.prisma.location.findMany({
      where: { tenantId: user.tenantId },
      select: { id: true },
      take: 2,
    });
    if (locations.length === 1) return locations[0].id;
    throw new BadRequestException({
      code: "LOCATION_REQUIRED",
      message:
        "Choose which location this tablet is for: open that location's queue and trust the device from there.",
    });
  }

  private async findActiveDeviceTrust(token: string) {
    const tokenHash = this.tokenService.hashDeviceTrustToken(token);
    const trust = await this.prisma.deviceTrust.findUnique({ where: { tokenHash } });
    if (!trust || trust.revokedAt || trust.expiresAt < new Date()) {
      throw invalidDeviceTrust();
    }
    return trust;
  }

  /** Rotate: revoke the presented trust token, issue a new one (ADR-004). Returns the new plaintext token. */
  private async rotateDeviceTrust(trust: {
    id: string;
    tenantId: string;
    locationId: string | null;
  }): Promise<string> {
    const generated = this.tokenService.generateDeviceTrustToken();
    await this.prisma.$transaction([
      this.prisma.deviceTrust.update({
        where: { id: trust.id },
        data: { revokedAt: new Date(), lastUsedAt: new Date() },
      }),
      this.prisma.deviceTrust.create({
        data: {
          tenantId: trust.tenantId,
          locationId: trust.locationId,
          tokenHash: generated.tokenHash,
          expiresAt: generated.expiresAt,
        },
      }),
    ]);
    return generated.token;
  }

  private async recordFailedPinAttempt(
    tenantUserId: string,
    currentAttempts: number,
  ): Promise<void> {
    const attempts = currentAttempts + 1;
    await this.prisma.tenantUser.update({
      where: { id: tenantUserId },
      data: {
        pinFailedAttempts: attempts,
        ...(attempts >= MAX_PIN_ATTEMPTS && {
          pinLockedUntil: new Date(Date.now() + PIN_LOCKOUT_MINUTES * 60_000),
        }),
      },
    });
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

  async getProfile(user: RequestUser): Promise<StaffProfile> {
    const membership = await this.prisma.tenantUser.findUniqueOrThrow({
      where: { id: user.tenantUserId },
      include: {
        user: { select: { displayName: true, email: true } },
        tenant: {
          select: { name: true, appointmentEnabled: true, logo: { select: { updatedAt: true } } },
        },
        location: { select: { name: true } },
      },
    });
    return {
      ...user,
      displayName: membership.user.displayName,
      email: membership.user.email,
      tenantName: membership.tenant.name,
      tenantLogoPath: tenantLogoPath(membership.tenantId, membership.tenant.logo),
      locationName: membership.location?.name ?? null,
      appointmentEnabled: membership.tenant.appointmentEnabled,
      publicName: membership.publicName,
    };
  }

  /** Phase 18 — the name customers see for this member at this business (blank = their display name). */
  async updatePublicName(user: RequestUser, publicName: string | null): Promise<StaffProfile> {
    await this.prisma.tenantUser.update({
      where: { id: user.tenantUserId },
      data: { publicName: publicName?.trim() || null },
    });
    return this.getProfile(user);
  }

  /** Authenticator setup step 1 for the logged-in staff member — the app shows "QueueFlow" with their email beneath (ADR-014). */
  async beginAuthenticatorSetup(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.authenticator.beginSetup({ userId }, "QueueFlow", user.email);
  }

  /** True (and consumed) if `submittedCode` is the user's latest live emailed code; a wrong guess counts against that code's attempts. */
  private async consumeEmailedCode(userId: string, submittedCode: string): Promise<boolean> {
    const latestCode = await this.prisma.loginCode.findFirst({
      where: { userId, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!latestCode || latestCode.attempts >= MAX_VERIFY_ATTEMPTS) {
      return false;
    }
    if (this.tokenService.hashLoginCode(submittedCode) !== latestCode.codeHash) {
      await this.prisma.loginCode.update({
        where: { id: latestCode.id },
        data: { attempts: { increment: 1 } },
      });
      return false;
    }
    await this.prisma.loginCode.update({
      where: { id: latestCode.id },
      data: { consumedAt: new Date() },
    });
    return true;
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
    const logo = await this.prisma.tenantLogo.findUnique({
      where: { tenantId: tenant.id },
      select: { updatedAt: true },
    });
    const tenantSummary: TenantSummary = {
      id: tenant.id,
      name: tenant.name,
      ownerName: tenant.ownerName,
      queueEnabled: tenant.queueEnabled,
      appointmentEnabled: tenant.appointmentEnabled,
      logoPath: tenantLogoPath(tenant.id, logo),
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

/** Who appears on a tablet's PIN list: its location's staff plus the business-wide roles (ADR-015). A pre-Phase-16 tablet with no location lists everyone. */
function tabletStaffFilter(locationId: string | null): Prisma.TenantUserWhereInput {
  if (!locationId) return {};
  return { OR: [{ locationId }, { role: { in: ["TENANT_OWNER", "TENANT_ADMIN"] } }] };
}

function canUseTablet(
  membership: { role: string; locationId: string | null },
  tabletLocationId: string | null,
): boolean {
  if (!tabletLocationId) return true;
  if (membership.role === "TENANT_OWNER" || membership.role === "TENANT_ADMIN") return true;
  return membership.locationId === tabletLocationId;
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

/** Phase 19 (ADR-018) — the root admins: a comma-separated allow-list in config, matched case-insensitively. */
export function isPlatformAdminEmail(allowList: string | undefined, email: string): boolean {
  if (!allowList) return false;
  const wanted = email.trim().toLowerCase();
  return allowList
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .some((entry) => entry.length > 0 && entry === wanted);
}
