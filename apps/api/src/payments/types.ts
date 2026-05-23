export type TransactionType =
  | "deposit"
  | "escrow_hold"
  | "escrow_release"
  | "payout"
  | "refund"
  | "commission";

export type TransactionStatus = "pending" | "completed" | "failed" | "cancelled";

export type EscrowStatus = "held" | "released" | "refunded";

export type FeeType = "commission" | "processing";
export type DeliverableStatus = "submitted" | "approved" | "rejected";

export type UserBalance = {
  userId: string;
  balanceCents: number;
  pendingCents: number;
  totalEarnedCents: number;
  totalWithdrawnCents: number;
  updatedAt: Date;
};

export type Transaction = {
  id: string;
  userId: string;
  type: TransactionType;
  amountCents: number;
  currency: string;
  status: TransactionStatus;
  stripePaymentIntentId: string | null;
  stripePayoutId: string | null;
  relatedCampaignId: string | null;
  relatedMatchId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type EscrowHold = {
  id: string;
  campaignId: string;
  matchId: string | null;
  brandUserId: string;
  creatorUserId: string | null;
  amountCents: number;
  commissionCents: number;
  status: EscrowStatus;
  depositTransactionId: string;
  releaseTransactionId: string | null;
  releasedAt: Date | null;
  refundedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PlatformFee = {
  id: string;
  transactionId: string;
  amountCents: number;
  feeType: FeeType;
  ratePercent: number;
  createdAt: Date;
};

export type MatchDeliverable = {
  id: string;
  matchId: string;
  creatorUserId: string;
  brandUserId: string;
  url: string;
  note: string;
  status: DeliverableStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type FundEscrowRequest = {
  matchId: string;
  amountCents: number;
};

export type PayoutRequest = {
  amountCents: number;
};

export type EscrowReleaseRequest = {
  escrowHoldId: string;
};

export type RefundRequest = {
  escrowHoldId: string;
  reason: string;
};

export type DeliverableRequest = {
  matchId: string;
  url: string;
  note: string;
};
