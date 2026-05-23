import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import type { ApiConfig } from "../config.js";
import type { PublicUser } from "./types.js";

export type AccessTokenClaims = {
  sub: string;
  email: string;
  role: string;
  emailVerified: boolean;
  status: string;
};

const encoder = new TextEncoder();

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createOpaqueToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function createSessionTokenParts(): {
  sessionId: string;
  secret: string;
  refreshToken: string;
} {
  const sessionId = randomUUID();
  const secret = createOpaqueToken();

  return {
    sessionId,
    secret,
    refreshToken: `${sessionId}.${secret}`
  };
}

export function parseRefreshToken(
  token: string
): { sessionId: string; secret: string } | null {
  const [sessionId, secret, extra] = token.split(".");

  if (!sessionId || !secret || extra !== undefined) {
    return null;
  }

  return { sessionId, secret };
}

export function safeEqual(value: string, expected: string): boolean {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function signAccessToken(
  user: PublicUser,
  config: Pick<ApiConfig, "accessTokenTtlSeconds" | "jwtSecret">
): Promise<string> {
  return new SignJWT({
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    status: user.status
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${config.accessTokenTtlSeconds}s`)
    .sign(encoder.encode(config.jwtSecret));
}

export async function verifyAccessToken(
  token: string,
  config: Pick<ApiConfig, "jwtSecret">
): Promise<AccessTokenClaims> {
  const result = await jwtVerify(token, encoder.encode(config.jwtSecret));

  return {
    sub: result.payload.sub ?? "",
    email: String(result.payload.email ?? ""),
    role: String(result.payload.role ?? ""),
    emailVerified: result.payload.emailVerified === true,
    status: String(result.payload.status ?? "active")
  };
}
