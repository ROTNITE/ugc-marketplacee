import type {
  DeliverableStatus,
  EscrowHold,
  EscrowStatus,
  FeeType,
  MatchDeliverable,
  PlatformFee,
  Transaction,
  TransactionStatus,
  TransactionType,
  UserBalance
} from "./types.js";
import type { PaymentStore } from "./store.js";

export class MemoryPaymentStore implements PaymentStore {
  readonly balances = new Map<string, UserBalance>();
  readonly transactions = new Map<string, Transaction>();
  readonly escrowHolds = new Map<string, EscrowHold>();
  readonly platformFees = new Map<string, PlatformFee>();
  readonly deliverables = new Map<string, MatchDeliverable>();

  async getUserBalance(userId: string): Promise<UserBalance | null> {
    return this.balances.get(userId) ?? null;
  }

  async createUserBalance(userId: string): Promise<UserBalance> {
    const existing = this.balances.get(userId);

    if (existing) {
      return existing;
    }

    const balance: UserBalance = {
      userId,
      balanceCents: 0,
      pendingCents: 0,
      totalEarnedCents: 0,
      totalWithdrawnCents: 0,
      updatedAt: new Date()
    };
    this.balances.set(userId, balance);
    return balance;
  }

  async updateBalance(
    userId: string,
    balanceDelta: number,
    pendingDelta: number,
    totalEarnedDelta = 0,
    totalWithdrawnDelta = 0
  ): Promise<UserBalance> {
    const current =
      (await this.getUserBalance(userId)) ?? (await this.createUserBalance(userId));
    const next = {
      ...current,
      balanceCents: current.balanceCents + balanceDelta,
      pendingCents: current.pendingCents + pendingDelta,
      totalEarnedCents: current.totalEarnedCents + totalEarnedDelta,
      totalWithdrawnCents: current.totalWithdrawnCents + totalWithdrawnDelta,
      updatedAt: new Date()
    };
    this.balances.set(userId, next);
    return next;
  }

  async createTransaction(params: {
    id: string;
    userId: string;
    type: TransactionType;
    amountCents: number;
    currency: string;
    status: TransactionStatus;
    stripePaymentIntentId?: string;
    stripePayoutId?: string;
    relatedCampaignId?: string;
    relatedMatchId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Transaction> {
    const now = new Date();
    const transaction: Transaction = {
      id: params.id,
      userId: params.userId,
      type: params.type,
      amountCents: params.amountCents,
      currency: params.currency,
      status: params.status,
      stripePaymentIntentId: params.stripePaymentIntentId ?? null,
      stripePayoutId: params.stripePayoutId ?? null,
      relatedCampaignId: params.relatedCampaignId ?? null,
      relatedMatchId: params.relatedMatchId ?? null,
      metadata: params.metadata ?? {},
      createdAt: now,
      updatedAt: now
    };
    this.transactions.set(transaction.id, transaction);
    return transaction;
  }

  async updateTransactionStatus(
    id: string,
    status: TransactionStatus
  ): Promise<Transaction> {
    const transaction = this.transactions.get(id);

    if (!transaction) {
      throw new Error("Transaction not found");
    }

    const next = { ...transaction, status, updatedAt: new Date() };
    this.transactions.set(id, next);
    return next;
  }

  async getTransaction(id: string): Promise<Transaction | null> {
    return this.transactions.get(id) ?? null;
  }

  async getTransactionByProviderId(providerId: string): Promise<Transaction | null> {
    return (
      [...this.transactions.values()].find(
        (transaction) => transaction.stripePaymentIntentId === providerId
      ) ?? null
    );
  }

  async getUserTransactions(
    userId: string,
    limit: number,
    offset: number
  ): Promise<Transaction[]> {
    return [...this.transactions.values()]
      .filter((transaction) => transaction.userId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(offset, offset + limit);
  }

  async createEscrowHold(params: {
    id: string;
    campaignId: string;
    matchId?: string;
    brandUserId: string;
    creatorUserId?: string;
    amountCents: number;
    commissionCents: number;
    depositTransactionId: string;
  }): Promise<EscrowHold> {
    const now = new Date();
    const escrowHold: EscrowHold = {
      id: params.id,
      campaignId: params.campaignId,
      matchId: params.matchId ?? null,
      brandUserId: params.brandUserId,
      creatorUserId: params.creatorUserId ?? null,
      amountCents: params.amountCents,
      commissionCents: params.commissionCents,
      status: "held",
      depositTransactionId: params.depositTransactionId,
      releaseTransactionId: null,
      releasedAt: null,
      refundedAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.escrowHolds.set(escrowHold.id, escrowHold);
    return escrowHold;
  }

  async getEscrowHold(id: string): Promise<EscrowHold | null> {
    return this.escrowHolds.get(id) ?? null;
  }

  async getEscrowHoldByCampaign(campaignId: string): Promise<EscrowHold | null> {
    return (
      [...this.escrowHolds.values()].find(
        (escrowHold) =>
          escrowHold.campaignId === campaignId && escrowHold.status === "held"
      ) ?? null
    );
  }

  async getEscrowHoldByMatch(matchId: string): Promise<EscrowHold | null> {
    return (
      [...this.escrowHolds.values()].find(
        (escrowHold) => escrowHold.matchId === matchId && escrowHold.status === "held"
      ) ?? null
    );
  }

  async getEscrowHoldForMatchIncludingProcessed(
    matchId: string
  ): Promise<EscrowHold | null> {
    return (
      [...this.escrowHolds.values()]
        .filter((escrowHold) => escrowHold.matchId === matchId)
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ??
      null
    );
  }

  async releaseEscrowHold(params: {
    escrowHoldId: string;
    releaseTransactionId: string;
  }): Promise<EscrowHold> {
    return this.updateEscrow(params.escrowHoldId, {
      status: "released",
      releaseTransactionId: params.releaseTransactionId,
      releasedAt: new Date()
    });
  }

  async refundEscrowHold(escrowHoldId: string): Promise<EscrowHold> {
    return this.updateEscrow(escrowHoldId, {
      status: "refunded",
      refundedAt: new Date()
    });
  }

  async createPlatformFee(params: {
    id: string;
    transactionId: string;
    amountCents: number;
    feeType: FeeType;
    ratePercent: number;
  }): Promise<PlatformFee> {
    const fee = {
      ...params,
      createdAt: new Date()
    };
    this.platformFees.set(fee.id, fee);
    return fee;
  }

  async createDeliverable(params: {
    id: string;
    matchId: string;
    creatorUserId: string;
    brandUserId: string;
    url: string;
    note: string;
  }): Promise<MatchDeliverable> {
    const existing = this.deliverables.get(params.matchId);
    const now = new Date();
    const deliverable: MatchDeliverable = {
      id: existing?.id ?? params.id,
      matchId: params.matchId,
      creatorUserId: params.creatorUserId,
      brandUserId: params.brandUserId,
      url: params.url,
      note: params.note,
      status: "submitted",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.deliverables.set(params.matchId, deliverable);
    return deliverable;
  }

  async getDeliverableByMatch(matchId: string): Promise<MatchDeliverable | null> {
    return this.deliverables.get(matchId) ?? null;
  }

  async updateDeliverableStatus(
    matchId: string,
    status: DeliverableStatus
  ): Promise<MatchDeliverable> {
    const deliverable = this.deliverables.get(matchId);

    if (!deliverable) {
      throw new Error("Deliverable not found");
    }

    const next = { ...deliverable, status, updatedAt: new Date() };
    this.deliverables.set(matchId, next);
    return next;
  }

  private async updateEscrow(
    escrowHoldId: string,
    patch: Partial<
      Pick<EscrowHold, "status" | "releaseTransactionId" | "releasedAt" | "refundedAt">
    >
  ): Promise<EscrowHold> {
    const escrowHold = this.escrowHolds.get(escrowHoldId);

    if (!escrowHold) {
      throw new Error("Escrow hold not found");
    }

    const next = {
      ...escrowHold,
      ...patch,
      status: (patch.status ?? escrowHold.status) as EscrowStatus,
      updatedAt: new Date()
    };
    this.escrowHolds.set(escrowHoldId, next);
    return next;
  }
}
