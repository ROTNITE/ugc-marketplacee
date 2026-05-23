import type { Router } from "express";
import { Router as createRouter } from "express";
import { requireAuth } from "../auth/middleware.js";
import type { AuthStore } from "../auth/store.js";
import type { ApiConfig } from "../config.js";
import type { MediaStorage } from "../integrations/media-storage.js";

export function createUploadRouter(
  storage: MediaStorage,
  config: Pick<ApiConfig, "jwtSecret">,
  authStore?: Pick<AuthStore, "findUserById">
): Router {
  const router = createRouter();
  const protectedRoute = requireAuth(config, authStore);

  router.post("/presign", protectedRoute, async (request, response, next) => {
    try {
      const { mimeType, sizeBytes } = request.body ?? {};
      if (typeof mimeType !== "string" || typeof sizeBytes !== "number") {
        response.status(400).json({
          error: { code: "INVALID_PAYLOAD", message: "mimeType and sizeBytes required" }
        });
        return;
      }
      const presigned = await storage.createUploadUrl({
        mimeType,
        sizeBytes,
        userId: request.auth?.sub ?? ""
      });
      response.json(presigned);
    } catch (error) {
      const message = (error as Error).message;
      response.status(400).json({ error: { code: "UPLOAD_REJECTED", message } });
      next();
    }
  });

  return router;
}
