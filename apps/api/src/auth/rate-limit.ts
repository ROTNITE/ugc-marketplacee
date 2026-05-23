import type { NextFunction, Request, Response } from "express";

/**
 * Minimal in-memory rate limiter for auth endpoints.
 *
 * Uses a sliding window per (route + client key). The client key is the
 * authenticated user id when available, falling back to the first IP in
 * X-Forwarded-For, then the socket remote address.
 *
 * This is intentionally dependency-free so the API stays installable in
 * restricted environments. Swap the in-memory map for Redis when the
 * service is deployed behind multiple instances.
 */

export type RateLimitOptions = {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum number of requests allowed inside the window. */
  max: number;
  /** Optional bucket name (useful when two routes share a path prefix). */
  bucket?: string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const store = new Map<string, Bucket>();

function getClientKey(request: Request): string {
  if (request.auth?.sub) {
    return `u:${request.auth.sub}`;
  }

  const forwarded = request.header("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return `ip:${first}`;
    }
  }

  return `ip:${request.ip ?? request.socket.remoteAddress ?? "unknown"}`;
}

export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max, bucket = "default" } = options;

  return (request: Request, response: Response, next: NextFunction) => {
    const key = `${bucket}:${request.method}:${request.path}:${getClientKey(request)}`;
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      response.setHeader("X-RateLimit-Limit", String(max));
      response.setHeader("X-RateLimit-Remaining", String(max - 1));
      next();
      return;
    }

    if (entry.count >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      response.setHeader("Retry-After", String(retryAfterSeconds));
      response.setHeader("X-RateLimit-Limit", String(max));
      response.setHeader("X-RateLimit-Remaining", "0");
      response.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Try again later."
        }
      });
      return;
    }

    entry.count += 1;
    response.setHeader("X-RateLimit-Limit", String(max));
    response.setHeader("X-RateLimit-Remaining", String(max - entry.count));
    next();
  };
}

/**
 * Test-only helper to clear the in-memory store between cases.
 */
export function _resetRateLimitStoreForTests(): void {
  store.clear();
}
