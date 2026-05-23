import type {
  AuthStore,
  CreateEmailOutboxInput,
  CreatePasswordResetTokenInput,
  CreateRefreshSessionInput,
  CreateUserInput,
  CreateVerificationTokenInput,
  ParentalConsentInput
} from "./store.js";
import type {
  EmailOutboxRecord,
  EmailVerificationTokenRecord,
  PasswordResetTokenRecord,
  RefreshSessionRecord,
  UserRecord,
  UserRole,
  UserStatus
} from "./types.js";

export class MemoryAuthStore implements AuthStore {
  readonly users = new Map<string, UserRecord>();
  readonly refreshSessions = new Map<string, RefreshSessionRecord>();
  readonly verificationTokens = new Map<string, EmailVerificationTokenRecord>();
  readonly passwordResetTokens = new Map<string, PasswordResetTokenRecord>();
  readonly emailOutbox: EmailOutboxRecord[] = [];

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    const now = new Date();
    const user: UserRecord = {
      id: input.id,
      email: input.email,
      passwordHash: input.passwordHash,
      emailVerifiedAt: null,
      role: input.role,
      status: "active",
      dateOfBirth: input.dateOfBirth,
      parentalConsentGrantedAt: null,
      parentalConsentEmail: null,
      totpSecret: null,
      totpEnabledAt: null,
      createdAt: now,
      updatedAt: now
    };

    this.users.set(user.id, user);
    return user;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return [...this.users.values()].find((user) => user.email === email) ?? null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async listUsers(input: {
    query: string | null;
    status: UserStatus | null;
    limit: number;
    offset: number;
  }): Promise<UserRecord[]> {
    const query = input.query?.toLowerCase() ?? null;

    return [...this.users.values()]
      .filter((user) => {
        if (query && !user.email.toLowerCase().includes(query)) {
          return false;
        }
        if (input.status && user.status !== input.status) {
          return false;
        }
        return true;
      })
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(input.offset, input.offset + input.limit);
  }

  async updateUserEmailVerified(userId: string, verifiedAt: Date): Promise<UserRecord> {
    const user = this.requireUser(userId);
    const next = { ...user, emailVerifiedAt: verifiedAt, updatedAt: verifiedAt };
    this.users.set(userId, next);
    return next;
  }

  async updateUserRole(userId: string, role: UserRole): Promise<UserRecord> {
    const user = this.requireUser(userId);
    const next = { ...user, role, updatedAt: new Date() };
    this.users.set(userId, next);
    return next;
  }

  async updateUserStatus(userId: string, status: UserStatus): Promise<UserRecord> {
    const user = this.requireUser(userId);
    const next = { ...user, status, updatedAt: new Date() };
    this.users.set(userId, next);
    return next;
  }

  async updateUserPasswordHash(
    userId: string,
    passwordHash: string
  ): Promise<UserRecord> {
    const user = this.requireUser(userId);
    const next = { ...user, passwordHash, updatedAt: new Date() };
    this.users.set(userId, next);
    return next;
  }

  async setParentalConsent(input: ParentalConsentInput): Promise<UserRecord> {
    const user = this.requireUser(input.userId);
    const next = {
      ...user,
      parentalConsentGrantedAt: input.grantedAt,
      parentalConsentEmail: input.parentEmail,
      updatedAt: input.grantedAt
    };
    this.users.set(input.userId, next);
    return next;
  }

  async setTotpSecret(
    userId: string,
    secret: string | null,
    enabledAt: Date | null
  ): Promise<UserRecord> {
    const user = this.requireUser(userId);
    const next = {
      ...user,
      totpSecret: secret,
      totpEnabledAt: enabledAt,
      updatedAt: new Date()
    };
    this.users.set(userId, next);
    return next;
  }

  async deleteUser(userId: string): Promise<void> {
    this.users.delete(userId);
    for (const session of [...this.refreshSessions.values()]) {
      if (session.userId === userId) {
        this.refreshSessions.delete(session.id);
      }
    }
    for (const token of [...this.verificationTokens.values()]) {
      if (token.userId === userId) {
        this.verificationTokens.delete(token.id);
      }
    }
    for (const token of [...this.passwordResetTokens.values()]) {
      if (token.userId === userId) {
        this.passwordResetTokens.delete(token.id);
      }
    }
    for (let i = this.emailOutbox.length - 1; i >= 0; i -= 1) {
      if (this.emailOutbox[i]?.userId === userId) {
        this.emailOutbox.splice(i, 1);
      }
    }
  }

  async createVerificationToken(
    input: CreateVerificationTokenInput
  ): Promise<EmailVerificationTokenRecord> {
    const token = {
      ...input,
      consumedAt: null,
      createdAt: new Date()
    };
    this.verificationTokens.set(token.id, token);
    return token;
  }

  async findVerificationTokenByHash(
    tokenHash: string
  ): Promise<EmailVerificationTokenRecord | null> {
    return (
      [...this.verificationTokens.values()].find(
        (token) => token.tokenHash === tokenHash
      ) ?? null
    );
  }

  async consumeVerificationToken(id: string, consumedAt: Date): Promise<void> {
    const token = this.verificationTokens.get(id);

    if (token) {
      this.verificationTokens.set(id, { ...token, consumedAt });
    }
  }

  async createPasswordResetToken(
    input: CreatePasswordResetTokenInput
  ): Promise<PasswordResetTokenRecord> {
    const token = {
      ...input,
      consumedAt: null,
      createdAt: new Date()
    };
    this.passwordResetTokens.set(token.id, token);
    return token;
  }

  async findPasswordResetTokenByHash(
    tokenHash: string
  ): Promise<PasswordResetTokenRecord | null> {
    return (
      [...this.passwordResetTokens.values()].find(
        (token) => token.tokenHash === tokenHash
      ) ?? null
    );
  }

  async consumePasswordResetToken(id: string, consumedAt: Date): Promise<void> {
    const token = this.passwordResetTokens.get(id);
    if (token) {
      this.passwordResetTokens.set(id, { ...token, consumedAt });
    }
  }

  async createRefreshSession(
    input: CreateRefreshSessionInput
  ): Promise<RefreshSessionRecord> {
    const now = new Date();
    const session = {
      ...input,
      revokedAt: null,
      replacedBySessionId: null,
      createdAt: now,
      updatedAt: now
    };
    this.refreshSessions.set(session.id, session);
    return session;
  }

  async findRefreshSessionById(id: string): Promise<RefreshSessionRecord | null> {
    return this.refreshSessions.get(id) ?? null;
  }

  async rotateRefreshSession(input: {
    currentSessionId: string;
    newSessionId: string;
    tokenHash: string;
    expiresAt: Date;
    rotatedAt: Date;
  }): Promise<RefreshSessionRecord> {
    const current = this.refreshSessions.get(input.currentSessionId);

    if (!current) {
      throw new Error("Missing current session.");
    }

    this.refreshSessions.set(current.id, {
      ...current,
      revokedAt: input.rotatedAt,
      replacedBySessionId: input.newSessionId,
      updatedAt: input.rotatedAt
    });

    return this.createRefreshSession({
      id: input.newSessionId,
      userId: current.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt
    });
  }

  async revokeRefreshSession(sessionId: string, revokedAt: Date): Promise<void> {
    const session = this.refreshSessions.get(sessionId);

    if (session) {
      this.refreshSessions.set(sessionId, {
        ...session,
        revokedAt: session.revokedAt ?? revokedAt,
        updatedAt: revokedAt
      });
    }
  }

  async revokeUserRefreshSessions(userId: string, revokedAt: Date): Promise<void> {
    for (const session of this.refreshSessions.values()) {
      if (session.userId === userId && !session.revokedAt) {
        this.refreshSessions.set(session.id, {
          ...session,
          revokedAt,
          updatedAt: revokedAt
        });
      }
    }
  }

  async createEmailOutbox(input: CreateEmailOutboxInput): Promise<EmailOutboxRecord> {
    const email = { ...input, createdAt: new Date() };
    this.emailOutbox.unshift(email);
    return email;
  }

  async listEmailOutbox(): Promise<EmailOutboxRecord[]> {
    return this.emailOutbox;
  }

  private requireUser(id: string): UserRecord {
    const user = this.users.get(id);

    if (!user) {
      throw new Error(`Missing user: ${id}`);
    }

    return user;
  }
}
