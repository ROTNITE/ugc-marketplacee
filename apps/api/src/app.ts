import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import type { loadConfig } from "./config.js";
import { createAuthRouter, authErrorHandler, createDevRouter } from "./auth/routes.js";
import { AuthService } from "./auth/service.js";
import type { AuthStore } from "./auth/store.js";
import { getHealthPayload } from "./health.js";
import { createChatRouter } from "./chat/routes.js";
import type { ChatService } from "./chat/service.js";
import { createMarketplaceRouter } from "./marketplace/routes.js";
import { MarketplaceService } from "./marketplace/service.js";
import type { MarketplaceStore } from "./marketplace/store.js";
import { createDeliverableRoutes, createPaymentRoutes } from "./payments/routes.js";
import type { PaymentService } from "./payments/service.js";
import { createRewardsRouter } from "./rewards/routes.js";
import type { RewardsService } from "./rewards/service.js";
import { createModerationRouter } from "./moderation/routes.js";
import type { ModerationService } from "./moderation/service.js";
import type { Notifier } from "./notifications/notifier.js";

export function createApp(options: {
  config: ReturnType<typeof loadConfig>;
  authStore: AuthStore;
  chatService?: ChatService;
  marketplaceStore?: MarketplaceStore;
  paymentService?: PaymentService;
  rewardsService?: RewardsService;
  moderationService?: ModerationService;
  notifier?: Notifier;
}) {
  const app = express();
  const authService = new AuthService(
    options.authStore,
    options.config,
    options.rewardsService
  );
  const marketplaceService = options.marketplaceStore
    ? new MarketplaceService(
        options.marketplaceStore,
        options.config,
        options.rewardsService,
        options.notifier
      )
    : null;

  app.use(helmet());
  app.use(
    cors({
      credentials: true,
      origin: options.config.webOrigin
    })
  );
  app.use(cookieParser());

  // Webhook endpoint needs raw body
  app.use("/payments/webhook", express.raw({ type: "application/json" }));

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json(getHealthPayload());
  });
  app.use("/auth", createAuthRouter(authService, options.config, options.authStore));
  if (marketplaceService) {
    app.use(
      "/",
      createMarketplaceRouter(marketplaceService, options.config, options.authStore)
    );
  }
  if (options.chatService) {
    app.use(
      "/",
      createChatRouter(options.chatService, options.config, options.authStore)
    );
  }
  if (options.paymentService) {
    app.use(
      "/payments",
      createPaymentRoutes(options.paymentService, options.config, options.authStore)
    );
    app.use(
      "/",
      createDeliverableRoutes(options.paymentService, options.config, options.authStore)
    );
  }
  if (options.rewardsService) {
    app.use(
      "/",
      createRewardsRouter(options.rewardsService, options.config, options.authStore)
    );
  }
  if (options.moderationService) {
    app.use(
      "/",
      createModerationRouter(options.moderationService, options.config, options.authStore)
    );
  }
  app.use("/dev", createDevRouter(options.authStore, options.config));
  app.use(authErrorHandler);
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction
    ) => {
      void _next;
      console.error(error);
      response.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Unexpected server error."
        }
      });
    }
  );

  return app;
}
