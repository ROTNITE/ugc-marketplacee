import type { NextFunction, Request, Response } from "express";
import type { ApiConfig } from "../config.js";
import { authErrors } from "./errors.js";
import { verifyAccessToken, type AccessTokenClaims } from "./security.js";
import type { AuthStore } from "./store.js";

declare module "express-serve-static-core" {
  interface Request {
    auth?: AccessTokenClaims;
  }
}

export function requireAuth(
  config: Pick<ApiConfig, "jwtSecret">,
  store?: Pick<AuthStore, "findUserById">
) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    const header = request.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

    if (!token) {
      next(authErrors.unauthorized());
      return;
    }

    try {
      const claims = await verifyAccessToken(token, config);

      if (!claims.sub || claims.status === "banned") {
        next(authErrors.unauthorized());
        return;
      }

      if (store) {
        const user = await store.findUserById(claims.sub);

        if (!user || user.status === "banned") {
          next(authErrors.unauthorized());
          return;
        }
      }

      request.auth = claims;
      next();
    } catch {
      next(authErrors.unauthorized());
    }
  };
}
