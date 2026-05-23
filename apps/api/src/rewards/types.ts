export type RewardLedgerType = "referral_bonus" | "credit_spent" | "manual_adjustment";

export type BadgeKey =
  | "first_completed_campaign"
  | "first_campaign_posted"
  | "first_match_funded"
  | "first_match"
  | "first_swipe"
  | "level_5"
  | "level_10"
  | "profile_completed"
  | "streak_3"
  | "streak_7";

export type GamificationEventType =
  | "campaign_posted"
  | "escrow_funded"
  | "match_created"
  | "profile_completed"
  | "swipe_action"
  | "campaign_completed";

export type ReferralCodeRecord = {
  userId: string;
  code: string;
  createdAt: Date;
};

export type ReferralRecord = {
  id: string;
  referrerUserId: string;
  referredUserId: string;
  code: string;
  rewardCredits: number;
  rewardedAt: Date | null;
  createdAt: Date;
};

export type RewardLedgerEntry = {
  id: string;
  userId: string;
  type: RewardLedgerType;
  amountCredits: number;
  relatedUserId: string | null;
  relatedMatchId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type UserBadge = {
  id: string;
  userId: string;
  badgeKey: BadgeKey;
  metadata: Record<string, unknown>;
  earnedAt: Date;
};

export type ReferralSummary = {
  code: string;
  inviteCount: number;
  rewardedCount: number;
  creditBalance: number;
};

export type UserProgress = {
  userId: string;
  xp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
  reputationScore: number;
  updatedAt: Date;
};

export type GamificationEvent = {
  id: string;
  userId: string;
  eventType: GamificationEventType;
  xpDelta: number;
  reputationDelta: number;
  relatedCampaignId: string | null;
  relatedMatchId: string | null;
  idempotencyKey: string | null;
  metadata: Record<string, unknown>;
  activityDate: string;
  createdAt: Date;
};

export type LeaderboardEntry = {
  userId: string;
  displayName: string;
  role: "creator" | "brand";
  xp: number;
  level: number;
  reputationScore: number;
  currentStreak: number;
  updatedAt: Date;
};
