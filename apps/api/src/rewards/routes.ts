import type { Router } from "express";
import { Router as createRouter } from "express";
import type { ApiConfig } from "../config.js";
import { requireAuth } from "../auth/middleware.js";
import type { AuthStore } from "../auth/store.js";
import type { RewardsService } from "./service.js";

export function createRewardsRouter(
  service: RewardsService,
  config: Pick<ApiConfig, "jwtSecret">,
  authStore: Pick<AuthStore, "findUserById">
): Router {
  const router = createRouter();
  const protectedRoute = requireAuth(config, authStore);

  router.get("/referrals/me", protectedRoute, async (request, response, next) => {
    try {
      response.json({ referrals: await service.getReferralSummary(request.auth!.sub) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/rewards/ledger", protectedRoute, async (request, response, next) => {
    try {
      response.json(await service.listLedger(request.auth!.sub, request.query));
    } catch (error) {
      next(error);
    }
  });

  router.get("/achievements/me", protectedRoute, async (request, response, next) => {
    try {
      response.json(await service.listBadges(request.auth!.sub));
    } catch (error) {
      next(error);
    }
  });

  router.get("/gamification/me", protectedRoute, async (request, response, next) => {
    try {
      response.json(await service.getGamificationSummary(request.auth!.sub));
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/gamification/leaderboard",
    protectedRoute,
    async (request, response, next) => {
      try {
        response.json(await service.listLeaderboard(request.query));
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
