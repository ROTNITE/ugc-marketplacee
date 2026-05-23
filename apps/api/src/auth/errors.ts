export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

export const authErrors = {
  duplicateEmail: () =>
    new AuthError("DUPLICATE_EMAIL", "Email is already registered.", 409),
  emailAlreadyVerified: () =>
    new AuthError("EMAIL_ALREADY_VERIFIED", "Email is already verified.", 409),
  emailNotVerified: () =>
    new AuthError("EMAIL_NOT_VERIFIED", "Email verification is required.", 403),
  invalidCredentials: () =>
    new AuthError("INVALID_CREDENTIALS", "Email or password is incorrect.", 401),
  invalidPayload: () =>
    new AuthError("INVALID_PAYLOAD", "Request payload is invalid.", 400),
  invalidRefreshToken: () =>
    new AuthError("INVALID_REFRESH_TOKEN", "Refresh token is invalid.", 401),
  invalidToken: () => new AuthError("INVALID_TOKEN", "Token is invalid.", 400),
  parentalConsentRequired: () =>
    new AuthError(
      "PARENTAL_CONSENT_REQUIRED",
      "This action requires parental consent for users under 18.",
      403
    ),
  tokenExpired: () => new AuthError("TOKEN_EXPIRED", "Token has expired.", 400),
  tokenUsed: () => new AuthError("TOKEN_USED", "Token has already been used.", 400),
  unauthorized: () => new AuthError("UNAUTHORIZED", "Authentication is required.", 401),
  userNotFound: () => new AuthError("USER_NOT_FOUND", "User was not found.", 404),
  underageNotAllowed: () =>
    new AuthError(
      "UNDERAGE_NOT_ALLOWED",
      "Users under 13 cannot register on the platform.",
      403
    )
};
