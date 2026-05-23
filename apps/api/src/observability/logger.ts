import pino from "pino";

/**
 * Application logger.
 *
 * Use this everywhere instead of `console.*`. Output is JSON in
 * production for ingestion by Loki/Datadog, and pretty-printed in
 * development for readability.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: {
    service: "ugc-api",
    env: process.env.NODE_ENV ?? "development"
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.refreshToken",
      "*.stripeSecretKey"
    ],
    censor: "[redacted]"
  }
});

export type Logger = typeof logger;
