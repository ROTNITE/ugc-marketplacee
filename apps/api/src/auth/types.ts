export type UserRole = "creator" | "brand" | "admin";
export type PublicUserRole = Exclude<UserRole, "admin">;
export type UserStatus = "active" | "banned";

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  role: UserRole;
  status: UserStatus;
  dateOfBirth: Date | null;
  parentalConsentGrantedAt: Date | null;
  parentalConsentEmail: string | null;
  totpSecret: string | null;
  totpEnabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  status: UserStatus;
  isMinor: boolean;
  parentalConsentGranted: boolean;
  totpEnabled: boolean;
};

export type RefreshSessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EmailVerificationTokenRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

export type PasswordResetTokenRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

export type EmailOutboxRecord = {
  id: string;
  userId: string;
  email: string;
  subject: string;
  body: string;
  token: string;
  createdAt: Date;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthResult = {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
};

/**
 * Minimum age (in years) at which a user is treated as an adult and does not
 * need parental consent for payments or direct messaging. Driven by COPPA-like
 * rules and the Russian Federal Law 152-FZ on personal data.
 */
export const ADULT_AGE_YEARS = 18;

export function calculateAgeYears(dateOfBirth: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export function isMinor(user: UserRecord, now: Date = new Date()): boolean {
  if (!user.dateOfBirth) {
    return false;
  }
  return calculateAgeYears(user.dateOfBirth, now) < ADULT_AGE_YEARS;
}

export function hasParentalConsent(user: UserRecord): boolean {
  return user.parentalConsentGrantedAt !== null;
}

/**
 * Returns true when the user is allowed to perform "adult" actions
 * (payments, direct messaging). Adults are always allowed; minors only if
 * parental consent has been granted.
 */
export function canPerformAdultActions(
  user: UserRecord,
  now: Date = new Date()
): boolean {
  if (!isMinor(user, now)) {
    return true;
  }
  return hasParentalConsent(user);
}

export function toPublicUser(user: UserRecord, now: Date = new Date()): PublicUser {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    role: user.role,
    status: user.status,
    isMinor: isMinor(user, now),
    parentalConsentGranted: hasParentalConsent(user),
    totpEnabled: user.totpEnabledAt !== null
  };
}

export function isUserRole(value: unknown): value is UserRole {
  return value === "creator" || value === "brand" || value === "admin";
}

export function isPublicUserRole(value: unknown): value is PublicUserRole {
  return value === "creator" || value === "brand";
}
