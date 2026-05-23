import pg from "pg";
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

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  email_verified_at: Date | null;
  role: UserRole;
  status: UserStatus;
  date_of_birth: Date | null;
  parental_consent_granted_at: Date | null;
  parental_consent_email: string | null;
  created_at: Date;
  updated_at: Date;
};

type RefreshSessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_session_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type VerificationTokenRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
};

type PasswordResetTokenRow = VerificationTokenRow;

type EmailOutboxRow = {
  id: string;
  user_id: string;
  email: string;
  subject: string;
  body: string;
  token: string;
  created_at: Date;
};

export class PgAuthStore implements AuthStore {
  constructor(private readonly pool: pg.Pool) {}

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    const result = await this.pool.query<UserRow>(
      `
        INSERT INTO users (id, email, password_hash, role, date_of_birth)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [input.id, input.email, input.passwordHash, input.role, input.dateOfBirth]
    );

    return mapUser(result.rows[0]);
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRow>(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [
      id
    ]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async listUsers(input: {
    query: string | null;
    status: UserStatus | null;
    limit: number;
    offset: number;
  }): Promise<UserRecord[]> {
    const result = await this.pool.query<UserRow>(
      `
        SELECT * FROM users
        WHERE ($1::text IS NULL OR email ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR status = $2)
        ORDER BY created_at DESC, id DESC
        LIMIT $3 OFFSET $4
      `,
      [input.query, input.status, input.limit, input.offset]
    );

    return result.rows.map(mapUser);
  }

  async updateUserEmailVerified(userId: string, verifiedAt: Date): Promise<UserRecord> {
    const result = await this.pool.query<UserRow>(
      `
        UPDATE users
        SET email_verified_at = $2, updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [userId, verifiedAt]
    );

    return mapUser(result.rows[0]);
  }

  async updateUserRole(userId: string, role: UserRole): Promise<UserRecord> {
    const result = await this.pool.query<UserRow>(
      `
        UPDATE users
        SET role = $2, updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [userId, role]
    );

    return mapUser(result.rows[0]);
  }

  async updateUserStatus(userId: string, status: UserStatus): Promise<UserRecord> {
    const result = await this.pool.query<UserRow>(
      `
        UPDATE users
        SET status = $2, updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [userId, status]
    );

    return mapUser(result.rows[0]);
  }

  async updateUserPasswordHash(
    userId: string,
    passwordHash: string
  ): Promise<UserRecord> {
    const result = await this.pool.query<UserRow>(
      `
        UPDATE users
        SET password_hash = $2, updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [userId, passwordHash]
    );
    return mapUser(result.rows[0]);
  }

  async setParentalConsent(input: ParentalConsentInput): Promise<UserRecord> {
    const result = await this.pool.query<UserRow>(
      `
        UPDATE users
        SET parental_consent_granted_at = $2,
            parental_consent_email = $3,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [input.userId, input.grantedAt, input.parentEmail]
    );
    return mapUser(result.rows[0]);
  }

  async deleteUser(userId: string): Promise<void> {
    await this.pool.query("DELETE FROM users WHERE id = $1", [userId]);
  }

  async createVerificationToken(
    input: CreateVerificationTokenInput
  ): Promise<EmailVerificationTokenRecord> {
    const result = await this.pool.query<VerificationTokenRow>(
      `
        INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [input.id, input.userId, input.tokenHash, input.expiresAt]
    );

    return mapVerificationToken(result.rows[0]);
  }

  async findVerificationTokenByHash(
    tokenHash: string
  ): Promise<EmailVerificationTokenRecord | null> {
    const result = await this.pool.query<VerificationTokenRow>(
      "SELECT * FROM email_verification_tokens WHERE token_hash = $1",
      [tokenHash]
    );
    return result.rows[0] ? mapVerificationToken(result.rows[0]) : null;
  }

  async consumeVerificationToken(id: string, consumedAt: Date): Promise<void> {
    await this.pool.query(
      "UPDATE email_verification_tokens SET consumed_at = $2 WHERE id = $1",
      [id, consumedAt]
    );
  }

  async createPasswordResetToken(
    input: CreatePasswordResetTokenInput
  ): Promise<PasswordResetTokenRecord> {
    const result = await this.pool.query<PasswordResetTokenRow>(
      `
        INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [input.id, input.userId, input.tokenHash, input.expiresAt]
    );
    return mapVerificationToken(result.rows[0]);
  }

  async findPasswordResetTokenByHash(
    tokenHash: string
  ): Promise<PasswordResetTokenRecord | null> {
    const result = await this.pool.query<PasswordResetTokenRow>(
      "SELECT * FROM password_reset_tokens WHERE token_hash = $1",
      [tokenHash]
    );
    return result.rows[0] ? mapVerificationToken(result.rows[0]) : null;
  }

  async consumePasswordResetToken(id: string, consumedAt: Date): Promise<void> {
    await this.pool.query(
      "UPDATE password_reset_tokens SET consumed_at = $2 WHERE id = $1",
      [id, consumedAt]
    );
  }

  async createRefreshSession(
    input: CreateRefreshSessionInput
  ): Promise<RefreshSessionRecord> {
    const result = await this.pool.query<RefreshSessionRow>(
      `
        INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [input.id, input.userId, input.tokenHash, input.expiresAt]
    );

    return mapRefreshSession(result.rows[0]);
  }

  async findRefreshSessionById(id: string): Promise<RefreshSessionRecord | null> {
    const result = await this.pool.query<RefreshSessionRow>(
      "SELECT * FROM refresh_sessions WHERE id = $1",
      [id]
    );
    return result.rows[0] ? mapRefreshSession(result.rows[0]) : null;
  }

  async rotateRefreshSession(input: {
    currentSessionId: string;
    newSessionId: string;
    tokenHash: string;
    expiresAt: Date;
    rotatedAt: Date;
  }): Promise<RefreshSessionRecord> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const current = await client.query<RefreshSessionRow>(
        `
          UPDATE refresh_sessions
          SET revoked_at = $2, replaced_by_session_id = $3, updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [input.currentSessionId, input.rotatedAt, input.newSessionId]
      );
      const currentSession = mapRefreshSession(current.rows[0]);
      const created = await client.query<RefreshSessionRow>(
        `
          INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `,
        [input.newSessionId, currentSession.userId, input.tokenHash, input.expiresAt]
      );
      await client.query("COMMIT");
      return mapRefreshSession(created.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeRefreshSession(sessionId: string, revokedAt: Date): Promise<void> {
    await this.pool.query(
      `
        UPDATE refresh_sessions
        SET revoked_at = COALESCE(revoked_at, $2), updated_at = now()
        WHERE id = $1
      `,
      [sessionId, revokedAt]
    );
  }

  async revokeUserRefreshSessions(userId: string, revokedAt: Date): Promise<void> {
    await this.pool.query(
      `
        UPDATE refresh_sessions
        SET revoked_at = COALESCE(revoked_at, $2), updated_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL
      `,
      [userId, revokedAt]
    );
  }

  async createEmailOutbox(input: CreateEmailOutboxInput): Promise<EmailOutboxRecord> {
    const result = await this.pool.query<EmailOutboxRow>(
      `
        INSERT INTO email_outbox (id, user_id, email, subject, body, token)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [input.id, input.userId, input.email, input.subject, input.body, input.token]
    );

    return mapEmailOutbox(result.rows[0]);
  }

  async listEmailOutbox(): Promise<EmailOutboxRecord[]> {
    const result = await this.pool.query<EmailOutboxRow>(
      "SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 50"
    );
    return result.rows.map(mapEmailOutbox);
  }
}

function mapUser(row: UserRow | undefined): UserRecord {
  if (!row) {
    throw new Error("Expected user row.");
  }

  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    emailVerifiedAt: row.email_verified_at,
    role: row.role,
    status: row.status,
    dateOfBirth: row.date_of_birth,
    parentalConsentGrantedAt: row.parental_consent_granted_at,
    parentalConsentEmail: row.parental_consent_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRefreshSession(row: RefreshSessionRow | undefined): RefreshSessionRecord {
  if (!row) {
    throw new Error("Expected refresh session row.");
  }

  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    replacedBySessionId: row.replaced_by_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapVerificationToken(
  row: VerificationTokenRow | undefined
): EmailVerificationTokenRecord {
  if (!row) {
    throw new Error("Expected verification token row.");
  }

  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at
  };
}

function mapEmailOutbox(row: EmailOutboxRow | undefined): EmailOutboxRecord {
  if (!row) {
    throw new Error("Expected email outbox row.");
  }

  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    subject: row.subject,
    body: row.body,
    token: row.token,
    createdAt: row.created_at
  };
}
