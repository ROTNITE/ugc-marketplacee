import type { NextFunction, Request, Response } from "express";
import { authErrors } from "./errors.js";
import type { AuthStore } from "./store.js";
import { canPerformAdultActions } from "./types.js";

/**
 * Express middleware that blocks "adult" actions (payments, direct messaging)
 * for users under 18 unless parental consent has been recorded.
 *
 * Must be mounted AFTER `requireAuth` so `request.auth` is populated.
 */
export function requireAdultActions(store: Pick<AuthStore, "findUserById">) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    const userId = request.auth?.sub;
    if (!userId) {
      next(authErrors.unauthorized());
      return;
    }

    try {
      const user = await store.findUserById(userId);
      if (!user) {
        next(authErrors.unauthorized());
        return;
      }

      if (!canPerformAdultActions(user)) {
        next(authErrors.parentalConsentRequired());
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
