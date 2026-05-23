import type {
  EmailOutboxRecord,
  EmailVerificationTokenRecord,
  RefreshSessionRecord,
  UserRecord,
  UserRole,
  UserStatus
} from "./types.js";

export type CreateUserInput = {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
};

export type CreateVerificationTokenInput = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

export type CreateRefreshSessionInput = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

export type CreateEmailOutboxInput = {
  id: string;
  userId: string;
  email: string;
  subject: string;
  body: string;
  token: string;
};

export type AuthStore = {
  createUser(input: CreateUserInput): Promise<UserRecord>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  listUsers(input: {
    query: string | null;
    status: UserStatus | null;
    limit: number;
    offset: number;
  }): Promise<UserRecord[]>;
  updateUserEmailVerified(userId: string, verifiedAt: Date): Promise<UserRecord>;
  updateUserRole(userId: string, role: UserRole): Promise<UserRecord>;
  updateUserStatus(userId: string, status: UserStatus): Promise<UserRecord>;
  createVerificationToken(
    input: CreateVerificationTokenInput
  ): Promise<EmailVerificationTokenRecord>;
  findVerificationTokenByHash(
    tokenHash: string
  ): Promise<EmailVerificationTokenRecord | null>;
  consumeVerificationToken(id: string, consumedAt: Date): Promise<void>;
  createRefreshSession(input: CreateRefreshSessionInput): Promise<RefreshSessionRecord>;
  findRefreshSessionById(id: string): Promise<RefreshSessionRecord | null>;
  rotateRefreshSession(input: {
    currentSessionId: string;
    newSessionId: string;
    tokenHash: string;
    expiresAt: Date;
    rotatedAt: Date;
  }): Promise<RefreshSessionRecord>;
  revokeRefreshSession(sessionId: string, revokedAt: Date): Promise<void>;
  revokeUserRefreshSessions(userId: string, revokedAt: Date): Promise<void>;
  createEmailOutbox(input: CreateEmailOutboxInput): Promise<EmailOutboxRecord>;
  listEmailOutbox(): Promise<EmailOutboxRecord[]>;
};
