import type { Router } from "express";
import { Router as createRouter } from "express";
import type { ApiConfig } from "../config.js";
import { requireAuth } from "../auth/middleware.js";
import type { AuthStore } from "../auth/store.js";
import type { ModerationService } from "./service.js";

export function createModerationRouter(
  service: ModerationService,
  config: Pick<ApiConfig, "jwtSecret">,
  authStore: Pick<AuthStore, "findUserById">
): Router {
  const router = createRouter();
  const protectedRoute = requireAuth(config, authStore);

  router.post("/moderation/reports", protectedRoute, async (request, response, next) => {
    try {
      response.status(201).json(await service.createReport(request.auth!, request.body));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/users", protectedRoute, async (request, response, next) => {
    try {
      response.json(await service.listUsers(request.auth!, request.query));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/users/:id/ban", protectedRoute, async (request, response, next) => {
    try {
      response.json(
        await service.setUserStatus(request.auth!, getParam(request.params.id), "banned")
      );
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/admin/users/:id/unban",
    protectedRoute,
    async (request, response, next) => {
      try {
        response.json(
          await service.setUserStatus(
            request.auth!,
            getParam(request.params.id),
            "active"
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.get("/admin/campaigns", protectedRoute, async (request, response, next) => {
    try {
      response.json(await service.listCampaigns(request.auth!, request.query));
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    "/admin/campaigns/:id",
    protectedRoute,
    async (request, response, next) => {
      try {
        response.json(
          await service.updateCampaign(
            request.auth!,
            getParam(request.params.id),
            request.body
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.get("/admin/reports", protectedRoute, async (request, response, next) => {
    try {
      response.json(await service.listReports(request.auth!, request.query));
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/admin/reports/:id/resolve",
    protectedRoute,
    async (request, response, next) => {
      try {
        response.json(
          await service.resolveReport(
            request.auth!,
            getParam(request.params.id),
            request.body
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.get("/admin/actions", protectedRoute, async (request, response, next) => {
    try {
      response.json(await service.listActions(request.auth!, request.query));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function getParam(value: string | undefined): string {
  if (!value) {
    throw new Error("Missing route param.");
  }

  return value;
}
