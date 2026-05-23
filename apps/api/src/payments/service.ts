import { randomUUID } from "node:crypto";
import type { ApiConfig } from "../config.js";
import type { MarketplaceStore } from "../marketplace/store.js";
import type { RewardsService } from "../rewards/service.js";
import type { PaymentStore } from "./store.js";
import { StripeService } from "./stripe.js";
import type {
  DeliverableRequest,
  EscrowHold,
  EscrowReleaseRequest,
  FundEscrowRequest,
  MatchDeliverable,
  PayoutRequest,
  RefundRequest,
  Transaction,
  UserBalance
} from "./types.js";
import { AuthError } from "../auth/errors.js";

export class PaymentService {
  private stripeService: StripeService;
  private store: PaymentStore;
  private config: Pick<ApiConfig, "platformCommissionPercent">;

  constructor(
    store: PaymentStore,
    private readonly marketplaceStore: MarketplaceStore,
    config: Pick<
      ApiConfig,
      "stripeSecretKey" | "stripeWebhookSecret" | "platformCommissionPercent"
    >,
    private readonly rewardsService?: RewardsService
  ) {
    this.store = store;
    this.config = config;
    this.stripeService = new StripeService(config);
  }

  async getUserBalance(userId: string): Promise<UserBalance> {
    let balance = await this.store.getUserBalance(userId);
    if (!balance) {
      balance = await this.store.createUserBalance(userId);
    }
    return balance;
  }

  async fundEscrowForMatch(
    brandUserId: string,
    request: FundEscrowRequest
  ): Promise<{ escrowHold: EscrowHold; transaction: Transaction }> {
    validateAmount(request.amountCents);
    const match = await this.getMatchForParticipant(brandUserId, request.matchId);

    if (match.brandUserId !== brandUserId) {
      throw new AuthError("FORBIDDEN", "Only the brand can fund this match", 403);
    }

    const existing = await this.store.getEscrowHoldForMatchIncludingProcessed(match.id);

    if (existing) {
      throw new AuthError("ESCROW_EXISTS", "Escrow already exists for this match", 400);
    }

    const transaction = await this.store.createTransaction({
      id: randomUUID(),
      userId: brandUserId,
      type: "deposit",
      amountCents: request.amountCents,
      currency: "RUB",
      status: "completed",
      relatedCampaignId: match.campaignId,
      relatedMatchId: match.id,
      metadata: {
        provider: "sandbox"
      }
    });

    const commissionCents = Math.floor(
      (request.amountCents * this.config.platformCommissionPercent) / 100
    );
    const escrowHold = await this.store.createEscrowHold({
      id: randomUUID(),
      campaignId: match.campaignId,
      matchId: match.id,
      brandUserId: match.brandUserId,
      creatorUserId: match.creatorUserId,
      amountCents: request.amountCents,
      commissionCents,
      depositTransactionId: transaction.id
    });

    await this.rewardsService?.awardEscrowFunded(brandUserId, {
      matchId: match.id,
      campaignId: match.campaignId
    });

    return {
      escrowHold,
      transaction
    };
  }

  async handlePaymentSuccess(paymentIntentId: string): Promise<void> {
    const transaction = await this.store.getTransactionByProviderId(paymentIntentId);

    if (!transaction) {
      throw new AuthError("PAYMENT_NOT_FOUND", "Payment transaction not found", 404);
    }
    if (transaction.status !== "pending") {
      return;
    }

    await this.store.updateTransactionStatus(transaction.id, "completed");
  }

  async releaseEscrow(
    brandUserId: string,
    request: EscrowReleaseRequest
  ): Promise<{ escrowHold: EscrowHold; transaction: Transaction }> {
    const escrowHold = await this.store.getEscrowHold(request.escrowHoldId);
    if (!escrowHold) {
      throw new AuthError("ESCROW_NOT_FOUND", "Escrow hold not found", 404);
    }

    if (escrowHold.brandUserId !== brandUserId) {
      throw new AuthError("FORBIDDEN", "You cannot release this escrow", 403);
    }

    if (escrowHold.status !== "held") {
      throw new AuthError("ESCROW_ALREADY_PROCESSED", "Escrow already processed", 400);
    }

    if (!escrowHold.matchId || !escrowHold.creatorUserId) {
      throw new AuthError("NO_MATCH", "No match associated with this escrow", 400);
    }

    const deliverable = await this.store.getDeliverableByMatch(escrowHold.matchId);
    if (!deliverable || deliverable.status !== "submitted") {
      throw new AuthError(
        "DELIVERABLE_REQUIRED",
        "A submitted deliverable is required before release",
        400
      );
    }

    const creatorUserId = escrowHold.creatorUserId;
    const creditsApplied =
      (await this.rewardsService?.applyCredits(
        creatorUserId,
        Math.floor(escrowHold.commissionCents / 100),
        {
          escrowHoldId: escrowHold.id,
          matchId: escrowHold.matchId,
          campaignId: escrowHold.campaignId,
          commissionBeforeCredits: escrowHold.commissionCents
        }
      )) ?? 0;
    const commissionAfterCredits = Math.max(
      0,
      escrowHold.commissionCents - creditsApplied * 100
    );
    const payoutAmount = escrowHold.amountCents - commissionAfterCredits;

    const releaseTransaction = await this.store.createTransaction({
      id: randomUUID(),
      userId: creatorUserId,
      type: "escrow_release",
      amountCents: payoutAmount,
      currency: "RUB",
      status: "completed",
      relatedCampaignId: escrowHold.campaignId,
      relatedMatchId: escrowHold.matchId,
      metadata: {
        escrowHoldId: escrowHold.id,
        originalAmount: escrowHold.amountCents,
        commission: commissionAfterCredits,
        commissionBeforeCredits: escrowHold.commissionCents,
        creditsApplied,
        commissionAfterCredits
      }
    });

    const updatedEscrow = await this.store.releaseEscrowHold({
      escrowHoldId: escrowHold.id,
      releaseTransactionId: releaseTransaction.id
    });

    if (commissionAfterCredits > 0) {
      await this.store.createPlatformFee({
        id: randomUUID(),
        transactionId: releaseTransaction.id,
        amountCents: commissionAfterCredits,
        feeType: "commission",
        ratePercent: this.config.platformCommissionPercent
      });
    }
    await this.getUserBalance(creatorUserId);
    await this.store.updateBalance(creatorUserId, payoutAmount, 0, payoutAmount, 0);
    await this.store.updateDeliverableStatus(escrowHold.matchId, "approved");
    await this.rewardsService?.awardCampaignCompleted(creatorUserId, {
      matchId: escrowHold.matchId,
      campaignId: escrowHold.campaignId
    });

    return {
      escrowHold: updatedEscrow,
      transaction: releaseTransaction
    };
  }

  async requestPayout(userId: string, request: PayoutRequest): Promise<Transaction> {
    validateAmount(request.amountCents);
    const balance = await this.getUserBalance(userId);

    if (balance.balanceCents < request.amountCents) {
      throw new AuthError("INSUFFICIENT_BALANCE", "Insufficient balance for payout", 400);
    }

    const transaction = await this.store.createTransaction({
      id: randomUUID(),
      userId,
      type: "payout",
      amountCents: request.amountCents,
      currency: "RUB",
      status: "pending",
      metadata: {}
    });

    await this.store.updateBalance(userId, -request.amountCents, request.amountCents);
    const completed = await this.store.updateTransactionStatus(
      transaction.id,
      "completed"
    );
    await this.store.updateBalance(
      userId,
      0,
      -request.amountCents,
      0,
      request.amountCents
    );

    return completed;
  }

  async refundEscrow(brandUserId: string, request: RefundRequest): Promise<EscrowHold> {
    const escrowHold = await this.store.getEscrowHold(request.escrowHoldId);
    if (!escrowHold) {
      throw new AuthError("ESCROW_NOT_FOUND", "Escrow hold not found", 404);
    }

    if (escrowHold.brandUserId !== brandUserId) {
      throw new AuthError("FORBIDDEN", "You cannot refund this escrow", 403);
    }

    if (escrowHold.status !== "held") {
      throw new AuthError("ESCROW_ALREADY_PROCESSED", "Escrow already processed", 400);
    }

    await this.store.createTransaction({
      id: randomUUID(),
      userId: brandUserId,
      type: "refund",
      amountCents: escrowHold.amountCents,
      currency: "RUB",
      status: "completed",
      relatedCampaignId: escrowHold.campaignId,
      metadata: {
        escrowHoldId: escrowHold.id,
        reason: request.reason
      }
    });

    if (escrowHold.matchId) {
      const deliverable = await this.store.getDeliverableByMatch(escrowHold.matchId);
      if (deliverable) {
        await this.store.updateDeliverableStatus(escrowHold.matchId, "rejected");
      }
    }

    return this.store.refundEscrowHold(escrowHold.id);
  }

  async submitDeliverable(
    userId: string,
    request: DeliverableRequest
  ): Promise<MatchDeliverable> {
    const match = await this.getMatchForParticipant(userId, request.matchId);
    if (match.creatorUserId !== userId) {
      throw new AuthError("FORBIDDEN", "Only the creator can submit deliverables", 403);
    }

    return this.store.createDeliverable({
      id: randomUUID(),
      matchId: match.id,
      creatorUserId: match.creatorUserId,
      brandUserId: match.brandUserId,
      url: parseDeliverableUrl(request.url),
      note: parseNote(request.note)
    });
  }

  async getDeliverableForMatch(
    userId: string,
    matchId: string
  ): Promise<MatchDeliverable | null> {
    await this.getMatchForParticipant(userId, matchId);
    return this.store.getDeliverableByMatch(matchId);
  }

  async getUserTransactions(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Transaction[]> {
    return this.store.getUserTransactions(userId, limit, offset);
  }

  async getEscrowHoldByCampaign(campaignId: string): Promise<EscrowHold | null> {
    return this.store.getEscrowHoldByCampaign(campaignId);
  }

  async getEscrowHoldByMatch(
    userId: string,
    matchId: string
  ): Promise<EscrowHold | null> {
    await this.getMatchForParticipant(userId, matchId);
    return this.store.getEscrowHoldForMatchIncludingProcessed(matchId);
  }

  private async getMatchForParticipant(userId: string, matchId: string) {
    const match = (await this.marketplaceStore.listMatchesForUser(userId)).find(
      (item) => item.id === matchId && item.status === "active"
    );

    if (!match) {
      throw new AuthError("MATCH_NOT_FOUND", "Match was not found", 404);
    }

    return match;
  }
}

function validateAmount(amountCents: number): void {
  if (!Number.isInteger(amountCents) || amountCents < 100) {
    throw new AuthError("AMOUNT_TOO_LOW", "Minimum amount is 100 cents", 400);
  }
}

function parseDeliverableUrl(value: string): string {
  if (typeof value !== "string") {
    throw new AuthError("INVALID_PAYLOAD", "Request payload is invalid.", 400);
  }

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("bad protocol");
    }
    return url.toString();
  } catch {
    throw new AuthError("INVALID_PAYLOAD", "Request payload is invalid.", 400);
  }
}

function parseNote(value: string): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string" || value.length > 1000) {
    throw new AuthError("INVALID_PAYLOAD", "Request payload is invalid.", 400);
  }
  return value.trim();
}
