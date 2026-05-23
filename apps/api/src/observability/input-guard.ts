import type { NextFunction, Request, Response } from "express";

/**
 * Defensive depth/breadth limits on incoming JSON bodies.
 *
 * `express.json` already caps the raw payload at 1 MB. This middleware adds
 * a second line of defence: it rejects deeply nested objects and oversized
 * arrays so attackers can't try to wedge the recommendation / moderation
 * stores with pathological payloads.
 */
export function inputGuard(options: { maxDepth: number; maxArrayLength: number }) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.body || typeof request.body !== "object") {
      next();
      return;
    }

    const result = inspect(request.body, options, 0);
    if (!result.ok) {
      response.status(413).json({
        error: { code: "PAYLOAD_TOO_COMPLEX", message: result.reason }
      });
      return;
    }
    next();
  };
}

function inspect(
  value: unknown,
  options: { maxDepth: number; maxArrayLength: number },
  depth: number
): { ok: true } | { ok: false; reason: string } {
  if (depth > options.maxDepth) {
    return { ok: false, reason: "Payload nested too deeply." };
  }
  if (Array.isArray(value)) {
    if (value.length > options.maxArrayLength) {
      return { ok: false, reason: "Array too long." };
    }
    for (const item of value) {
      const result = inspect(item, options, depth + 1);
      if (!result.ok) return result;
    }
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const result = inspect((value as Record<string, unknown>)[key], options, depth + 1);
      if (!result.ok) return result;
    }
  }
  return { ok: true };
}
