import type { Router } from "express";
import { Router as createRouter } from "express";
import type { ApiConfig } from "../config.js";
import { requireAuth } from "../auth/middleware.js";
import type { AuthStore } from "../auth/store.js";
import type { MarketplaceService } from "./service.js";

export function createMarketplaceRouter(
  service: MarketplaceService,
  config: Pick<ApiConfig, "jwtSecret">,
  authStore: Pick<AuthStore, "findUserById">
): Router {
  const router = createRouter();
  const protectedRoute = requireAuth(config, authStore);

  router.get("/profiles/me", protectedRoute, async (request, response, next) => {
    try {
      response.json({ profile: await service.getMyProfile(request.auth!) });
    } catch (error) {
      next(error);
    }
  });

  router.put("/profiles/me", protectedRoute, async (request, response, next) => {
    try {
      response.json({
        profile: await service.saveMyProfile(request.auth!, request.body)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/campaigns/mine", protectedRoute, async (request, response, next) => {
    try {
      response.json({ campaigns: await service.listMyCampaigns(request.auth!) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/campaigns", protectedRoute, async (request, response, next) => {
    try {
      response.status(201).json({
        campaign: await service.createCampaign(request.auth!, request.body)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/campaigns/:id", protectedRoute, async (request, response, next) => {
    try {
      response.json({
        campaign: await service.getCampaign(
          request.auth!,
          getRequiredParam(request.params.id)
        )
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/campaigns/:id", protectedRoute, async (request, response, next) => {
    try {
      response.json({
        campaign: await service.updateCampaign(
          request.auth!,
          getRequiredParam(request.params.id),
          request.body
        )
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/feed/campaigns", protectedRoute, async (request, response, next) => {
    try {
      response.json(await service.listFeed(request.auth!, request.query));
    } catch (error) {
      next(error);
    }
  });

  router.get("/feed/creators", protectedRoute, async (request, response, next) => {
    try {
      response.json(await service.listCreatorFeed(request.auth!, request.query));
    } catch (error) {
      next(error);
    }
  });

  router.post("/interactions", protectedRoute, async (request, response, next) => {
    try {
      response
        .status(201)
        .json(await service.recordInteraction(request.auth!, request.body));
    } catch (error) {
      next(error);
    }
  });

  router.get("/favorites", protectedRoute, async (request, response, next) => {
    try {
      response.json(await service.listFavorites(request.auth!));
    } catch (error) {
      next(error);
    }
  });

  router.get("/matches", protectedRoute, async (request, response, next) => {
    try {
      response.json(await service.listMatches(request.auth!));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function getRequiredParam(value: string | undefined): string {
  if (!value) {
    throw new Error("Missing route parameter.");
  }

  return value;
}
