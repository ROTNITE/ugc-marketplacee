import type { CookieOptions, Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { ApiConfig } from "../config.js";
import { isAuthError } from "./errors.js";
import { requireAuth } from "./middleware.js";
import type { AuthService } from "./service.js";
import type { AuthStore } from "./store.js";

const refreshCookieName = "ugc_refresh";

export function createAuthRouter(
  service: AuthService,
  config: Pick<
    ApiConfig,
    "cookieSameSite" | "cookieSecure" | "jwtSecret" | "nodeEnv" | "refreshTokenTtlDays"
  >,
  store: Pick<AuthStore, "findUserById">
): Router {
  const router = createRouter();
  const protectedRoute = requireAuth(config, store);

  router.post("/register", async (request, response, next) => {
    try {
      response.status(201).json(await service.register(request.body));
    } catch (error) {
      next(error);
    }
  });

  router.post("/verify-email", async (request, response, next) => {
    try {
      response.json(await service.verifyEmail(request.body));
    } catch (error) {
      next(error);
    }
  });

  router.post("/resend-verification", async (request, response, next) => {
    try {
      await service.resendVerification(request.body);
      response.status(202).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/login", async (request, response, next) => {
    try {
      sendAuthResult(response, await service.login(request.body), config);
    } catch (error) {
      next(error);
    }
  });

  router.post("/refresh", async (request, response, next) => {
    try {
      sendAuthResult(
        response,
        await service.refresh(request.cookies?.[refreshCookieName]),
        config
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", async (request, response, next) => {
    try {
      await service.logout(request.cookies?.[refreshCookieName]);
      response.clearCookie(refreshCookieName, getClearRefreshCookieOptions(config));
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", protectedRoute, async (request, response, next) => {
    try {
      response.json({ user: await service.getCurrentUser(request.auth?.sub ?? "") });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/me/role", protectedRoute, async (request, response, next) => {
    try {
      response.json(await service.switchRole(request.auth?.sub ?? "", request.body));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createDevRouter(
  store: Pick<AuthStore, "listEmailOutbox">,
  config: Pick<ApiConfig, "nodeEnv">
): Router {
  const router = createRouter();

  router.get("/email-outbox", async (_request, response, next) => {
    try {
      if (config.nodeEnv === "production") {
        response
          .status(404)
          .json({ error: { code: "NOT_FOUND", message: "Not found." } });
        return;
      }

      response.json({ emails: await store.listEmailOutbox() });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function authErrorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  next: (error: unknown) => void
) {
  if (!isAuthError(error)) {
    next(error);
    return;
  }

  response.status(error.status).json({
    error: {
      code: error.code,
      message: error.message
    }
  });
}

function sendAuthResult(
  response: Response,
  result: { user: unknown; accessToken: string; refreshToken: string },
  config: Pick<ApiConfig, "cookieSameSite" | "cookieSecure" | "refreshTokenTtlDays">
): void {
  response.cookie(
    refreshCookieName,
    result.refreshToken,
    getRefreshCookieOptions(config)
  );
  response.json({
    user: result.user,
    accessToken: result.accessToken
  });
}

function getRefreshCookieOptions(
  config: Pick<ApiConfig, "cookieSameSite" | "cookieSecure" | "refreshTokenTtlDays">
): CookieOptions {
  return {
    httpOnly: true,
    maxAge: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
    path: "/auth"
  };
}

function getClearRefreshCookieOptions(
  config: Pick<ApiConfig, "cookieSameSite" | "cookieSecure">
): CookieOptions {
  return {
    httpOnly: true,
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
    path: "/auth"
  };
}
