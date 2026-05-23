import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { PaymentService } from "./service.js";
import { requireAuth } from "../auth/middleware.js";
import { requireAdultActions } from "../auth/adult-actions.js";
import type { AuthStore } from "../auth/store.js";
import type { AccessTokenClaims } from "../auth/security.js";
import type { ApiConfig } from "../config.js";
import { logger } from "../observability/logger.js";

type AuthRequest = Request & { auth: AccessTokenClaims };

export function createPaymentRoutes(
  paymentService: PaymentService,
  config: Pick<ApiConfig, "jwtSecret">,
  authStore?: Pick<AuthStore, "findUserById">
): Router {
  const router = Router();
  const protectedRoute = requireAuth(config, authStore);
  const adultActions = authStore ? requireAdultActions(authStore) : null;

  // Get user balance
  router.get(
    "/balance",
    protectedRoute,
    route(async (req: Request, res: Response) => {
      const { auth } = req as AuthRequest;
      const balance = await paymentService.getUserBalance(auth.sub);
      res.json({ balance });
    })
  );

  // Get user transactions
  router.get(
    "/transactions",
    protectedRoute,
    route(async (req: Request, res: Response) => {
      const { auth } = req as AuthRequest;
      const limit = Number.parseInt(req.query.limit as string) || 50;
      const offset = Number.parseInt(req.query.offset as string) || 0;

      const transactions = await paymentService.getUserTransactions(
        auth.sub,
        limit,
        offset
      );
      res.json({ transactions });
    })
  );

  router.post(
    "/escrow/fund",
    protectedRoute,
    ...(adultActions ? [adultActions] : []),
    route(async (req: Request, res: Response) => {
      const { auth } = req as AuthRequest;
      const { matchId, amountCents } = req.body;

      if (!matchId || !amountCents) {
        res.status(400).json({
          error: { code: "INVALID_REQUEST", message: "Missing required fields" }
        });
        return;
      }

      if (amountCents < 100) {
        res.status(400).json({
          error: { code: "AMOUNT_TOO_LOW", message: "Minimum deposit is 100 cents" }
        });
        return;
      }

      const result = await paymentService.fundEscrowForMatch(auth.sub, {
        matchId,
        amountCents
      });

      res.status(201).json({
        transaction: result.transaction,
        escrowHold: result.escrowHold
      });
    })
  );

  // Release escrow (brand approves work)
  router.post(
    "/escrow/release",
    protectedRoute,
    ...(adultActions ? [adultActions] : []),
    route(async (req: Request, res: Response) => {
      const { auth } = req as AuthRequest;
      const { escrowHoldId } = req.body;

      if (!escrowHoldId) {
        res.status(400).json({
          error: { code: "INVALID_REQUEST", message: "Missing required fields" }
        });
        return;
      }

      const result = await paymentService.releaseEscrow(auth.sub, {
        escrowHoldId
      });

      res.json({
        escrowHold: result.escrowHold,
        transaction: result.transaction
      });
    })
  );

  // Refund escrow (brand cancels)
  router.post(
    "/escrow/refund",
    protectedRoute,
    ...(adultActions ? [adultActions] : []),
    route(async (req: Request, res: Response) => {
      const { auth } = req as AuthRequest;
      const { escrowHoldId, reason } = req.body;

      if (!escrowHoldId || !reason) {
        res.status(400).json({
          error: { code: "INVALID_REQUEST", message: "Missing required fields" }
        });
        return;
      }

      const escrowHold = await paymentService.refundEscrow(auth.sub, {
        escrowHoldId,
        reason
      });

      res.json({ escrowHold });
    })
  );

  // Request payout (creator withdraws)
  router.post(
    "/payout",
    protectedRoute,
    ...(adultActions ? [adultActions] : []),
    route(async (req: Request, res: Response) => {
      const { auth } = req as AuthRequest;
      const { amountCents } = req.body;

      if (!amountCents) {
        res.status(400).json({
          error: { code: "INVALID_REQUEST", message: "Missing amount" }
        });
        return;
      }

      if (amountCents < 100) {
        res.status(400).json({
          error: { code: "AMOUNT_TOO_LOW", message: "Minimum payout is 100 cents" }
        });
        return;
      }

      const transaction = await paymentService.requestPayout(auth.sub, { amountCents });

      res.status(201).json({ transaction });
    })
  );

  // Get escrow hold by campaign
  router.get(
    "/escrow/campaign/:campaignId",
    protectedRoute,
    route(async (req: Request, res: Response) => {
      const { campaignId } = req.params;

      if (!campaignId) {
        res.status(400).json({
          error: { code: "INVALID_REQUEST", message: "Missing campaignId" }
        });
        return;
      }

      const escrowHold = await paymentService.getEscrowHoldByCampaign(campaignId);

      if (!escrowHold) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "No escrow hold found for this campaign" }
        });
        return;
      }

      res.json({ escrowHold });
    })
  );

  // Get escrow hold by match
  router.get(
    "/escrow/match/:matchId",
    protectedRoute,
    route(async (req: Request, res: Response) => {
      const { matchId } = req.params;

      if (!matchId) {
        res.status(400).json({
          error: { code: "INVALID_REQUEST", message: "Missing matchId" }
        });
        return;
      }

      const { auth } = req as AuthRequest;
      const escrowHold = await paymentService.getEscrowHoldByMatch(auth.sub, matchId);

      if (!escrowHold) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "No escrow hold found for this match" }
        });
        return;
      }

      res.json({ escrowHold });
    })
  );

  // Stripe webhook endpoint
  router.post(
    "/webhook",
    route(async (req: Request, res: Response) => {
      const signature = req.headers["stripe-signature"] as string;

      if (!signature) {
        res.status(400).json({
          error: { code: "MISSING_SIGNATURE", message: "Missing Stripe signature" }
        });
        return;
      }

      try {
        // Note: req.body should be raw buffer for webhook verification
        // This requires express.raw() middleware for this route
        const event = await paymentService["stripeService"].constructWebhookEvent(
          req.body,
          signature
        );

        // Handle different event types
        switch (event.type) {
          case "payment_intent.succeeded": {
            const paymentIntent = event.data.object;
            await paymentService.handlePaymentSuccess(paymentIntent.id);
            break;
          }
          case "payment_intent.payment_failed": {
            // Handle failed payment
            logger.error({ event: event.data.object }, "payment failed");
            break;
          }
          default:
            logger.warn({ type: event.type }, "unhandled stripe event");
        }

        res.json({ received: true });
      } catch (error) {
        logger.error({ err: error }, "stripe webhook error");
        res.status(400).json({
          error: { code: "WEBHOOK_ERROR", message: "Webhook processing failed" }
        });
      }
    })
  );

  return router;
}

export function createDeliverableRoutes(
  paymentService: PaymentService,
  config: Pick<ApiConfig, "jwtSecret">,
  authStore?: Pick<AuthStore, "findUserById">
): Router {
  const router = Router();
  const protectedRoute = requireAuth(config, authStore);
  const adultActions = authStore ? requireAdultActions(authStore) : null;

  router.post(
    "/deliverables",
    protectedRoute,
    ...(adultActions ? [adultActions] : []),
    route(async (req: Request, res: Response) => {
      const { auth } = req as AuthRequest;
      const { matchId, url, note } = req.body;

      if (!matchId || !url) {
        res.status(400).json({
          error: { code: "INVALID_REQUEST", message: "Missing required fields" }
        });
        return;
      }

      const deliverable = await paymentService.submitDeliverable(auth.sub, {
        matchId,
        url,
        note: note ?? ""
      });
      res.status(201).json({ deliverable });
    })
  );

  router.get(
    "/deliverables/match/:matchId",
    protectedRoute,
    route(async (req: Request, res: Response) => {
      const { auth } = req as AuthRequest;
      const { matchId } = req.params;

      if (!matchId) {
        res.status(400).json({
          error: { code: "INVALID_REQUEST", message: "Missing matchId" }
        });
        return;
      }

      const deliverable = await paymentService.getDeliverableForMatch(auth.sub, matchId);

      if (!deliverable) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "No deliverable found for this match" }
        });
        return;
      }

      res.json({ deliverable });
    })
  );

  return router;
}

function route(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}
