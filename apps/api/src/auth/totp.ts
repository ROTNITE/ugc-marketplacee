import { Secret, TOTP } from "otpauth";

const ISSUER = "UGC Marketplace";

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function buildTotpUri(email: string, secret: string): string {
  const totp = new TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret)
  });
  return totp.toString();
}

/**
 * Verifies a 6-digit TOTP code. Accepts a ±1-step drift to tolerate clock
 * skew between the server and the user's authenticator app.
 */
export function verifyTotp(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code.trim())) return false;
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret)
  });
  const delta = totp.validate({ token: code.trim(), window: 1 });
  return delta !== null;
}
