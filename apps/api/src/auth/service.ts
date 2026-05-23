import { randomUUID } from "node:crypto";
import type { ApiConfig } from "../config.js";
import { AuthError, authErrors } from "./errors.js";
import {
  createOpaqueToken,
  createSessionTokenParts,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  parseRefreshToken,
  safeEqual,
  signAccessToken,
  verifyPassword
} from "./security.js";
import type { AuthStore } from "./store.js";
import type { AuthResult, PublicUser, PublicUserRole, UserRecord } from "./types.js";
import { isPublicUserRole, toPublicUser } from "./types.js";
import type { RewardsService } from "../rewards/service.js";

export type RegisterInput = {
  email: unknown;
  password: unknown;
  role: unknown;
  referralCode?: unknown;
};

export type LoginInput = {
  email: unknown;
  password: unknown;
};

export type VerifyEmailInput = {
  token: unknown;
};

export type ResendVerificationInput = {
  email: unknown;
};

export type SwitchRoleInput = {
  role: unknown;
};

export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly config: Pick<
      ApiConfig,
      | "accessTokenTtlSeconds"
      | "adminEmails"
      | "emailVerificationTtlHours"
      | "jwtSecret"
      | "refreshTokenTtlDays"
      | "webAppUrl"
    >,
    private readonly rewardsService?: RewardsService
  ) {}

  async register(input: RegisterInput): Promise<{ user: PublicUser }> {
    const payload = parseRegisterInput(input);
    const existing = await this.store.findUserByEmail(payload.email);

    if (existing) {
      throw authErrors.duplicateEmail();
    }

    if (this.rewardsService) {
      await this.rewardsService.validateReferralCode(payload.referralCode);
    }

    const user = await this.store.createUser({
      id: randomUUID(),
      email: payload.email,
      passwordHash: await hashPassword(payload.password),
      role: payload.role
    });
    if (this.rewardsService) {
      await this.rewardsService.initializeUser(user.id, payload.referralCode);
    }
    await this.createVerificationEmail(user);

    return { user: toPublicUser(user) };
  }

  async verifyEmail(
    input: VerifyEmailInput,
    now = new Date()
  ): Promise<{ user: PublicUser }> {
    if (typeof input.token !== "string" || input.token.trim().length === 0) {
      throw authErrors.invalidPayload();
    }

    const tokenHash = hashOpaqueToken(input.token.trim());
    const token = await this.store.findVerificationTokenByHash(tokenHash);

    if (!token) {
      throw authErrors.invalidToken();
    }
    if (token.consumedAt) {
      throw authErrors.tokenUsed();
    }
    if (token.expiresAt.getTime() <= now.getTime()) {
      throw authErrors.tokenExpired();
    }

    await this.store.consumeVerificationToken(token.id, now);
    let user = await this.store.updateUserEmailVerified(token.userId, now);

    if (this.config.adminEmails.includes(user.email)) {
      user = await this.store.updateUserRole(user.id, "admin");
    }
    await this.rewardsService?.rewardVerifiedReferral(user.id);

    return { user: toPublicUser(user) };
  }

  async resendVerification(input: ResendVerificationInput): Promise<{ sent: boolean }> {
    if (typeof input.email !== "string") {
      throw authErrors.invalidPayload();
    }

    const user = await this.store.findUserByEmail(normalizeEmail(input.email));

    if (!user || user.emailVerifiedAt) {
      return { sent: false };
    }

    await this.createVerificationEmail(user);
    return { sent: true };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const payload = parseLoginInput(input);
    let user = await this.store.findUserByEmail(payload.email);

    if (!user || !(await verifyPassword(payload.password, user.passwordHash))) {
      throw authErrors.invalidCredentials();
    }
    if (user.status === "banned") {
      throw authErrors.unauthorized();
    }
    if (!user.emailVerifiedAt) {
      throw authErrors.emailNotVerified();
    }
    user = await this.ensureAdminRole(user);

    return this.createAuthResult(user);
  }

  async refresh(refreshToken: string | undefined, now = new Date()): Promise<AuthResult> {
    if (!refreshToken) {
      throw authErrors.invalidRefreshToken();
    }

    const parsed = parseRefreshToken(refreshToken);

    if (!parsed) {
      throw authErrors.invalidRefreshToken();
    }

    const currentSession = await this.store.findRefreshSessionById(parsed.sessionId);

    if (!currentSession) {
      throw authErrors.invalidRefreshToken();
    }

    if (currentSession.revokedAt) {
      await this.store.revokeUserRefreshSessions(currentSession.userId, now);
      throw authErrors.invalidRefreshToken();
    }

    if (currentSession.expiresAt.getTime() <= now.getTime()) {
      await this.store.revokeRefreshSession(currentSession.id, now);
      throw authErrors.invalidRefreshToken();
    }

    const expectedHash = hashOpaqueToken(parsed.secret);

    if (!safeEqual(expectedHash, currentSession.tokenHash)) {
      await this.store.revokeUserRefreshSessions(currentSession.userId, now);
      throw authErrors.invalidRefreshToken();
    }

    let user = await this.store.findUserById(currentSession.userId);

    if (!user) {
      throw authErrors.invalidRefreshToken();
    }
    if (user.status === "banned") {
      await this.store.revokeUserRefreshSessions(user.id, now);
      throw authErrors.invalidRefreshToken();
    }
    user = await this.ensureAdminRole(user);

    const nextToken = createSessionTokenParts();
    const nextSession = await this.store.rotateRefreshSession({
      currentSessionId: currentSession.id,
      newSessionId: nextToken.sessionId,
      tokenHash: hashOpaqueToken(nextToken.secret),
      expiresAt: addDays(now, this.config.refreshTokenTtlDays),
      rotatedAt: now
    });
    const publicUser = toPublicUser(user);

    return {
      user: publicUser,
      accessToken: await signAccessToken(publicUser, this.config),
      refreshToken: `${nextSession.id}.${nextToken.secret}`
    };
  }

  async logout(refreshToken: string | undefined, now = new Date()): Promise<void> {
    const parsed = refreshToken ? parseRefreshToken(refreshToken) : null;

    if (parsed) {
      await this.store.revokeRefreshSession(parsed.sessionId, now);
    }
  }

  async getCurrentUser(userId: string): Promise<PublicUser> {
    let user = await this.store.findUserById(userId);

    if (!user) {
      throw authErrors.userNotFound();
    }

    user = await this.ensureAdminRole(user);
    return toPublicUser(user);
  }

  async switchRole(
    userId: string,
    input: SwitchRoleInput
  ): Promise<{
    user: PublicUser;
    accessToken: string;
  }> {
    if (!isPublicUserRole(input.role)) {
      throw authErrors.invalidPayload();
    }

    const current = await this.store.findUserById(userId);

    if (!current) {
      throw authErrors.userNotFound();
    }
    if (current.role === "admin") {
      throw new AuthError("FORBIDDEN", "Admins cannot switch workspace roles.", 403);
    }

    const user = await this.store.updateUserRole(userId, input.role);
    const publicUser = toPublicUser(user);

    return {
      user: publicUser,
      accessToken: await signAccessToken(publicUser, this.config)
    };
  }

  private async createAuthResult(user: UserRecord): Promise<AuthResult> {
    const publicUser = toPublicUser(user);
    const sessionToken = createSessionTokenParts();

    await this.store.createRefreshSession({
      id: sessionToken.sessionId,
      userId: user.id,
      tokenHash: hashOpaqueToken(sessionToken.secret),
      expiresAt: addDays(new Date(), this.config.refreshTokenTtlDays)
    });

    return {
      user: publicUser,
      accessToken: await signAccessToken(publicUser, this.config),
      refreshToken: sessionToken.refreshToken
    };
  }

  private async ensureAdminRole(user: UserRecord): Promise<UserRecord> {
    if (this.config.adminEmails.includes(user.email) && user.role !== "admin") {
      return this.store.updateUserRole(user.id, "admin");
    }

    return user;
  }

  private async createVerificationEmail(user: UserRecord): Promise<void> {
    const token = createOpaqueToken();
    const verificationUrl = `${this.config.webAppUrl}/verify-email?token=${token}`;

    await this.store.createVerificationToken({
      id: randomUUID(),
      userId: user.id,
      tokenHash: hashOpaqueToken(token),
      expiresAt: addHours(new Date(), this.config.emailVerificationTtlHours)
    });
    await this.store.createEmailOutbox({
      id: randomUUID(),
      userId: user.id,
      email: user.email,
      subject: "Verify your UGC Marketplace email",
      body: `Open this link to verify your email: ${verificationUrl}`,
      token
    });
  }
}

function parseRegisterInput(input: RegisterInput): {
  email: string;
  password: string;
  role: PublicUserRole;
  referralCode?: unknown;
} {
  if (
    typeof input.email !== "string" ||
    typeof input.password !== "string" ||
    !isPublicUserRole(input.role)
  ) {
    throw authErrors.invalidPayload();
  }

  const email = normalizeEmail(input.email);

  if (!isValidEmail(email) || input.password.length < 8) {
    throw authErrors.invalidPayload();
  }

  return {
    email,
    password: input.password,
    role: input.role,
    referralCode: input.referralCode
  };
}

function parseLoginInput(input: LoginInput): { email: string; password: string } {
  if (typeof input.email !== "string" || typeof input.password !== "string") {
    throw authErrors.invalidPayload();
  }

  const email = normalizeEmail(input.email);

  if (!isValidEmail(email) || input.password.length === 0) {
    throw authErrors.invalidPayload();
  }

  return { email, password: input.password };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
