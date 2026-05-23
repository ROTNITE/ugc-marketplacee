import type { Router } from "express";
import { Router as createRouter } from "express";
import type { ApiConfig } from "../config.js";
import { requireAuth } from "../auth/middleware.js";
import type { AuthStore } from "../auth/store.js";
import type { ChatService } from "./service.js";

export function createChatRouter(
  service: ChatService,
  config: Pick<ApiConfig, "jwtSecret">,
  authStore?: Pick<AuthStore, "findUserById">
): Router {
  const router = createRouter();
  const protectedRoute = requireAuth(config, authStore);

  router.get("/chat/threads", protectedRoute, async (request, response, next) => {
    try {
      response.json(await service.listThreads(request.auth!));
    } catch (error) {
      next(error);
    }
  });

  router.post("/chat/threads", protectedRoute, async (request, response, next) => {
    try {
      response.status(201).json(await service.createThread(request.auth!, request.body));
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/chat/threads/:threadId/messages",
    protectedRoute,
    async (request, response, next) => {
      try {
        response.json(
          await service.listMessages(
            request.auth!,
            getRequiredParam(request.params.threadId),
            {
              cursor: request.query.cursor,
              limit: request.query.limit
            }
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/chat/threads/:threadId/messages",
    protectedRoute,
    async (request, response, next) => {
      try {
        response
          .status(201)
          .json(
            await service.sendMessage(
              request.auth!,
              getRequiredParam(request.params.threadId),
              request.body
            )
          );
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/chat/threads/:threadId/read",
    protectedRoute,
    async (request, response, next) => {
      try {
        response.json(
          await service.markRead(request.auth!, getRequiredParam(request.params.threadId))
        );
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

function getRequiredParam(value: string | undefined): string {
  if (!value) {
    throw new Error("Missing route parameter.");
  }

  return value;
}
