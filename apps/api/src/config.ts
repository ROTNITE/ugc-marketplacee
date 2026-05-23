import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), "../../.env") });

export type ApiConfig = {
  accessTokenTtlSeconds: number;
  adminEmails: string[];
  bannedKeywords: string[];
  cookieSameSite: "lax" | "strict" | "none";
  cookieSecure: boolean;
  databaseUrl: string;
  emailVerificationTtlHours: number;
  host: string;
  jwtSecret: string;
  port: number;
  nodeEnv: string;
  refreshTokenTtlDays: number;
  webAppUrl: string;
  webOrigin: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  platformCommissionPercent: number;
  referralSignupBonusCredits: number;
};

export function loadConfig(env = process.env): ApiConfig {
  return {
    accessTokenTtlSeconds: Number.parseInt(env.ACCESS_TOKEN_TTL_SECONDS ?? "900", 10),
    adminEmails: parseList(env.ADMIN_EMAILS).map((email) => email.toLowerCase()),
    bannedKeywords: parseList(
      env.BANNED_KEYWORDS ?? "gambling,casino,adult,porn,drugs,наркотики,казино"
    ),
    cookieSameSite: parseSameSite(env.COOKIE_SAME_SITE),
    cookieSecure: env.COOKIE_SECURE === "true",
    databaseUrl:
      env.DATABASE_URL ?? "postgresql://ugc:ugc@localhost:5432/ugc_marketplace",
    emailVerificationTtlHours: Number.parseInt(
      env.EMAIL_VERIFICATION_TTL_HOURS ?? "24",
      10
    ),
    host: env.API_HOST ?? "0.0.0.0",
    jwtSecret: env.JWT_SECRET ?? "replace-with-local-development-secret",
    port: Number.parseInt(env.API_PORT ?? "4000", 10),
    nodeEnv: env.NODE_ENV ?? "development",
    refreshTokenTtlDays: Number.parseInt(env.REFRESH_TOKEN_TTL_DAYS ?? "30", 10),
    webAppUrl: env.WEB_APP_URL ?? "http://localhost:3000",
    webOrigin: env.WEB_ORIGIN ?? "http://localhost:3000",
    stripeSecretKey: env.STRIPE_SECRET_KEY ?? "",
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? "",
    platformCommissionPercent: Number.parseFloat(env.PLATFORM_COMMISSION_PERCENT ?? "10"),
    referralSignupBonusCredits: Number.parseInt(
      env.REFERRAL_SIGNUP_BONUS_CREDITS ?? "50",
      10
    )
  };
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSameSite(value: string | undefined): "lax" | "strict" | "none" {
  if (value === "strict" || value === "none") {
    return value;
  }

  return "lax";
}
