import type { Pool } from "pg";
import type {
  UserBalance,
  Transaction,
  EscrowHold,
  MatchDeliverable,
  PlatformFee,
  TransactionType,
  TransactionStatus,
  EscrowStatus,
  FeeType,
  DeliverableStatus
} from "./types.js";

export interface PaymentStore {
  getUserBalance(userId: string): Promise<UserBalance | null>;
  createUserBalance(userId: string): Promise<UserBalance>;
  updateBalance(
    userId: string,
    balanceDelta: number,
    pendingDelta: number,
    totalEarnedDelta?: number,
    totalWithdrawnDelta?: number
  ): Promise<UserBalance>;

  createTransaction(params: {
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
  }): Promise<Transaction>;

  updateTransactionStatus(id: string, status: TransactionStatus): Promise<Transaction>;
  getTransaction(id: string): Promise<Transaction | null>;
  getTransactionByProviderId(providerId: string): Promise<Transaction | null>;
  getUserTransactions(
    userId: string,
    limit: number,
    offset: number
  ): Promise<Transaction[]>;

  createEscrowHold(params: {
    id: string;
    campaignId: string;
    matchId?: string;
    brandUserId: string;
    creatorUserId?: string;
    amountCents: number;
    commissionCents: number;
    depositTransactionId: string;
  }): Promise<EscrowHold>;

  getEscrowHold(id: string): Promise<EscrowHold | null>;
  getEscrowHoldByCampaign(campaignId: string): Promise<EscrowHold | null>;
  getEscrowHoldByMatch(matchId: string): Promise<EscrowHold | null>;
  getEscrowHoldForMatchIncludingProcessed(matchId: string): Promise<EscrowHold | null>;

  releaseEscrowHold(params: {
    escrowHoldId: string;
    releaseTransactionId: string;
  }): Promise<EscrowHold>;

  refundEscrowHold(escrowHoldId: string): Promise<EscrowHold>;

  createPlatformFee(params: {
    id: string;
    transactionId: string;
    amountCents: number;
    feeType: FeeType;
    ratePercent: number;
  }): Promise<PlatformFee>;

  createDeliverable(params: {
    id: string;
    matchId: string;
    creatorUserId: string;
    brandUserId: string;
    url: string;
    note: string;
  }): Promise<MatchDeliverable>;

  getDeliverableByMatch(matchId: string): Promise<MatchDeliverable | null>;

  updateDeliverableStatus(
    matchId: string,
    status: DeliverableStatus
  ): Promise<MatchDeliverable>;
}

export class PostgresPaymentStore implements PaymentStore {
  constructor(private pool: Pool) {}

  async getUserBalance(userId: string): Promise<UserBalance | null> {
    const result = await this.pool.query<{
      user_id: string;
      balance_cents: number;
      pending_cents: number;
      total_earned_cents: number;
      total_withdrawn_cents: number;
      updated_at: Date;
    }>(
      `SELECT user_id, balance_cents, pending_cents, total_earned_cents,
              total_withdrawn_cents, updated_at
       FROM user_balances WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      userId: row.user_id,
      balanceCents: row.balance_cents,
      pendingCents: row.pending_cents,
      totalEarnedCents: row.total_earned_cents,
      totalWithdrawnCents: row.total_withdrawn_cents,
      updatedAt: row.updated_at
    };
  }

  async createUserBalance(userId: string): Promise<UserBalance> {
    const result = await this.pool.query<{
      user_id: string;
      balance_cents: number;
      pending_cents: number;
      total_earned_cents: number;
      total_withdrawn_cents: number;
      updated_at: Date;
    }>(
      `INSERT INTO user_balances (user_id, balance_cents, pending_cents,
                                   total_earned_cents, total_withdrawn_cents)
       VALUES ($1, 0, 0, 0, 0)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = user_balances.updated_at
       RETURNING user_id, balance_cents, pending_cents, total_earned_cents,
                 total_withdrawn_cents, updated_at`,
      [userId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to create user balance");
    }

    return {
      userId: row.user_id,
      balanceCents: row.balance_cents,
      pendingCents: row.pending_cents,
      totalEarnedCents: row.total_earned_cents,
      totalWithdrawnCents: row.total_withdrawn_cents,
      updatedAt: row.updated_at
    };
  }

  async updateBalance(
    userId: string,
    balanceDelta: number,
    pendingDelta: number,
    totalEarnedDelta = 0,
    totalWithdrawnDelta = 0
  ): Promise<UserBalance> {
    const result = await this.pool.query<{
      user_id: string;
      balance_cents: number;
      pending_cents: number;
      total_earned_cents: number;
      total_withdrawn_cents: number;
      updated_at: Date;
    }>(
      `UPDATE user_balances
       SET balance_cents = balance_cents + $2,
           pending_cents = pending_cents + $3,
           total_earned_cents = total_earned_cents + $4,
           total_withdrawn_cents = total_withdrawn_cents + $5,
           updated_at = now()
       WHERE user_id = $1
       RETURNING user_id, balance_cents, pending_cents, total_earned_cents,
                 total_withdrawn_cents, updated_at`,
      [userId, balanceDelta, pendingDelta, totalEarnedDelta, totalWithdrawnDelta]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to update user balance");
    }

    return {
      userId: row.user_id,
      balanceCents: row.balance_cents,
      pendingCents: row.pending_cents,
      totalEarnedCents: row.total_earned_cents,
      totalWithdrawnCents: row.total_withdrawn_cents,
      updatedAt: row.updated_at
    };
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
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      type: TransactionType;
      amount_cents: number;
      currency: string;
      status: TransactionStatus;
      stripe_payment_intent_id: string | null;
      stripe_payout_id: string | null;
      related_campaign_id: string | null;
      related_match_id: string | null;
      metadata: Record<string, unknown>;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO transactions (id, user_id, type, amount_cents, currency, status,
                                  stripe_payment_intent_id, stripe_payout_id,
                                  related_campaign_id, related_match_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        params.id,
        params.userId,
        params.type,
        params.amountCents,
        params.currency,
        params.status,
        params.stripePaymentIntentId ?? null,
        params.stripePayoutId ?? null,
        params.relatedCampaignId ?? null,
        params.relatedMatchId ?? null,
        JSON.stringify(params.metadata ?? {})
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to create transaction");
    }

    return this.mapTransaction(row);
  }

  async updateTransactionStatus(
    id: string,
    status: TransactionStatus
  ): Promise<Transaction> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      type: TransactionType;
      amount_cents: number;
      currency: string;
      status: TransactionStatus;
      stripe_payment_intent_id: string | null;
      stripe_payout_id: string | null;
      related_campaign_id: string | null;
      related_match_id: string | null;
      metadata: Record<string, unknown>;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE transactions
       SET status = $2, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, status]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Transaction not found");
    }

    return this.mapTransaction(row);
  }

  async getTransaction(id: string): Promise<Transaction | null> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      type: TransactionType;
      amount_cents: number;
      currency: string;
      status: TransactionStatus;
      stripe_payment_intent_id: string | null;
      stripe_payout_id: string | null;
      related_campaign_id: string | null;
      related_match_id: string | null;
      metadata: Record<string, unknown>;
      created_at: Date;
      updated_at: Date;
    }>(`SELECT * FROM transactions WHERE id = $1`, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return this.mapTransaction(row);
  }

  async getTransactionByProviderId(providerId: string): Promise<Transaction | null> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      type: TransactionType;
      amount_cents: number;
      currency: string;
      status: TransactionStatus;
      stripe_payment_intent_id: string | null;
      stripe_payout_id: string | null;
      related_campaign_id: string | null;
      related_match_id: string | null;
      metadata: Record<string, unknown>;
      created_at: Date;
      updated_at: Date;
    }>(`SELECT * FROM transactions WHERE stripe_payment_intent_id = $1`, [providerId]);

    return result.rows[0] ? this.mapTransaction(result.rows[0]) : null;
  }

  async getUserTransactions(
    userId: string,
    limit: number,
    offset: number
  ): Promise<Transaction[]> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      type: TransactionType;
      amount_cents: number;
      currency: string;
      status: TransactionStatus;
      stripe_payment_intent_id: string | null;
      stripe_payout_id: string | null;
      related_campaign_id: string | null;
      related_match_id: string | null;
      metadata: Record<string, unknown>;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT * FROM transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return result.rows
      .filter((row): row is NonNullable<typeof row> => row !== undefined)
      .map((row) => this.mapTransaction(row));
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
    const result = await this.pool.query<{
      id: string;
      campaign_id: string;
      match_id: string | null;
      brand_user_id: string;
      creator_user_id: string | null;
      amount_cents: number;
      commission_cents: number;
      status: EscrowStatus;
      deposit_transaction_id: string;
      release_transaction_id: string | null;
      released_at: Date | null;
      refunded_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO escrow_holds (id, campaign_id, match_id, brand_user_id, creator_user_id,
                                  amount_cents, commission_cents, status, deposit_transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'held', $8)
       RETURNING *`,
      [
        params.id,
        params.campaignId,
        params.matchId ?? null,
        params.brandUserId,
        params.creatorUserId ?? null,
        params.amountCents,
        params.commissionCents,
        params.depositTransactionId
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to create escrow hold");
    }

    return this.mapEscrowHold(row);
  }

  async getEscrowHold(id: string): Promise<EscrowHold | null> {
    const result = await this.pool.query<{
      id: string;
      campaign_id: string;
      match_id: string | null;
      brand_user_id: string;
      creator_user_id: string | null;
      amount_cents: number;
      commission_cents: number;
      status: EscrowStatus;
      deposit_transaction_id: string;
      release_transaction_id: string | null;
      released_at: Date | null;
      refunded_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(`SELECT * FROM escrow_holds WHERE id = $1`, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return this.mapEscrowHold(row);
  }

  async getEscrowHoldByCampaign(campaignId: string): Promise<EscrowHold | null> {
    const result = await this.pool.query<{
      id: string;
      campaign_id: string;
      match_id: string | null;
      brand_user_id: string;
      creator_user_id: string | null;
      amount_cents: number;
      commission_cents: number;
      status: EscrowStatus;
      deposit_transaction_id: string;
      release_transaction_id: string | null;
      released_at: Date | null;
      refunded_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT * FROM escrow_holds
       WHERE campaign_id = $1 AND status = 'held'
       ORDER BY created_at DESC
       LIMIT 1`,
      [campaignId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return this.mapEscrowHold(row);
  }

  async getEscrowHoldByMatch(matchId: string): Promise<EscrowHold | null> {
    const result = await this.pool.query<{
      id: string;
      campaign_id: string;
      match_id: string | null;
      brand_user_id: string;
      creator_user_id: string | null;
      amount_cents: number;
      commission_cents: number;
      status: EscrowStatus;
      deposit_transaction_id: string;
      release_transaction_id: string | null;
      released_at: Date | null;
      refunded_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT * FROM escrow_holds
       WHERE match_id = $1 AND status = 'held'
       ORDER BY created_at DESC
       LIMIT 1`,
      [matchId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return this.mapEscrowHold(row);
  }

  async getEscrowHoldForMatchIncludingProcessed(
    matchId: string
  ): Promise<EscrowHold | null> {
    const result = await this.pool.query<{
      id: string;
      campaign_id: string;
      match_id: string | null;
      brand_user_id: string;
      creator_user_id: string | null;
      amount_cents: number;
      commission_cents: number;
      status: EscrowStatus;
      deposit_transaction_id: string;
      release_transaction_id: string | null;
      released_at: Date | null;
      refunded_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT * FROM escrow_holds
       WHERE match_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [matchId]
    );

    return result.rows[0] ? this.mapEscrowHold(result.rows[0]) : null;
  }

  async releaseEscrowHold(params: {
    escrowHoldId: string;
    releaseTransactionId: string;
  }): Promise<EscrowHold> {
    const result = await this.pool.query<{
      id: string;
      campaign_id: string;
      match_id: string | null;
      brand_user_id: string;
      creator_user_id: string | null;
      amount_cents: number;
      commission_cents: number;
      status: EscrowStatus;
      deposit_transaction_id: string;
      release_transaction_id: string | null;
      released_at: Date | null;
      refunded_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE escrow_holds
       SET status = 'released',
           release_transaction_id = $2,
           released_at = now(),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [params.escrowHoldId, params.releaseTransactionId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Escrow hold not found");
    }

    return this.mapEscrowHold(row);
  }

  async refundEscrowHold(escrowHoldId: string): Promise<EscrowHold> {
    const result = await this.pool.query<{
      id: string;
      campaign_id: string;
      match_id: string | null;
      brand_user_id: string;
      creator_user_id: string | null;
      amount_cents: number;
      commission_cents: number;
      status: EscrowStatus;
      deposit_transaction_id: string;
      release_transaction_id: string | null;
      released_at: Date | null;
      refunded_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE escrow_holds
       SET status = 'refunded',
           refunded_at = now(),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [escrowHoldId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Escrow hold not found");
    }

    return this.mapEscrowHold(row);
  }

  async createPlatformFee(params: {
    id: string;
    transactionId: string;
    amountCents: number;
    feeType: FeeType;
    ratePercent: number;
  }): Promise<PlatformFee> {
    const result = await this.pool.query<{
      id: string;
      transaction_id: string;
      amount_cents: number;
      fee_type: FeeType;
      rate_percent: string;
      created_at: Date;
    }>(
      `INSERT INTO platform_fees (id, transaction_id, amount_cents, fee_type, rate_percent)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        params.id,
        params.transactionId,
        params.amountCents,
        params.feeType,
        params.ratePercent
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to create platform fee");
    }

    return {
      id: row.id,
      transactionId: row.transaction_id,
      amountCents: row.amount_cents,
      feeType: row.fee_type,
      ratePercent: Number.parseFloat(row.rate_percent),
      createdAt: row.created_at
    };
  }

  async createDeliverable(params: {
    id: string;
    matchId: string;
    creatorUserId: string;
    brandUserId: string;
    url: string;
    note: string;
  }): Promise<MatchDeliverable> {
    const result = await this.pool.query<DeliverableRow>(
      `INSERT INTO match_deliverables (
         id, match_id, creator_user_id, brand_user_id, url, note, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'submitted')
       ON CONFLICT (match_id)
       DO UPDATE SET
         url = EXCLUDED.url,
         note = EXCLUDED.note,
         status = 'submitted',
         updated_at = now()
       RETURNING *`,
      [
        params.id,
        params.matchId,
        params.creatorUserId,
        params.brandUserId,
        params.url,
        params.note
      ]
    );

    return mapDeliverable(result.rows[0]);
  }

  async getDeliverableByMatch(matchId: string): Promise<MatchDeliverable | null> {
    const result = await this.pool.query<DeliverableRow>(
      "SELECT * FROM match_deliverables WHERE match_id = $1",
      [matchId]
    );

    return result.rows[0] ? mapDeliverable(result.rows[0]) : null;
  }

  async updateDeliverableStatus(
    matchId: string,
    status: DeliverableStatus
  ): Promise<MatchDeliverable> {
    const result = await this.pool.query<DeliverableRow>(
      `UPDATE match_deliverables
       SET status = $2, updated_at = now()
       WHERE match_id = $1
       RETURNING *`,
      [matchId, status]
    );

    return mapDeliverable(result.rows[0]);
  }

  private mapTransaction(row: {
    id: string;
    user_id: string;
    type: TransactionType;
    amount_cents: number;
    currency: string;
    status: TransactionStatus;
    stripe_payment_intent_id: string | null;
    stripe_payout_id: string | null;
    related_campaign_id: string | null;
    related_match_id: string | null;
    metadata: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
  }): Transaction {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      amountCents: row.amount_cents,
      currency: row.currency,
      status: row.status,
      stripePaymentIntentId: row.stripe_payment_intent_id,
      stripePayoutId: row.stripe_payout_id,
      relatedCampaignId: row.related_campaign_id,
      relatedMatchId: row.related_match_id,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapEscrowHold(row: {
    id: string;
    campaign_id: string;
    match_id: string | null;
    brand_user_id: string;
    creator_user_id: string | null;
    amount_cents: number;
    commission_cents: number;
    status: EscrowStatus;
    deposit_transaction_id: string;
    release_transaction_id: string | null;
    released_at: Date | null;
    refunded_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }): EscrowHold {
    return {
      id: row.id,
      campaignId: row.campaign_id,
      matchId: row.match_id,
      brandUserId: row.brand_user_id,
      creatorUserId: row.creator_user_id,
      amountCents: row.amount_cents,
      commissionCents: row.commission_cents,
      status: row.status,
      depositTransactionId: row.deposit_transaction_id,
      releaseTransactionId: row.release_transaction_id,
      releasedAt: row.released_at,
      refundedAt: row.refunded_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

type DeliverableRow = {
  id: string;
  match_id: string;
  creator_user_id: string;
  brand_user_id: string;
  url: string;
  note: string;
  status: DeliverableStatus;
  created_at: Date;
  updated_at: Date;
};

function mapDeliverable(row: DeliverableRow | undefined): MatchDeliverable {
  if (!row) {
    throw new Error("Expected deliverable row");
  }

  return {
    id: row.id,
    matchId: row.match_id,
    creatorUserId: row.creator_user_id,
    brandUserId: row.brand_user_id,
    url: row.url,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
