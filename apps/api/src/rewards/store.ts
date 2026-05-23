import type { Pool } from "pg";
import type {
  BadgeKey,
  GamificationEvent,
  GamificationEventType,
  LeaderboardEntry,
  ReferralCodeRecord,
  ReferralRecord,
  RewardLedgerEntry,
  RewardLedgerType,
  UserProgress,
  UserBadge
} from "./types.js";

export type RewardsStore = {
  getReferralCodeByUser(userId: string): Promise<ReferralCodeRecord | null>;
  getReferralCode(code: string): Promise<ReferralCodeRecord | null>;
  createReferralCode(input: {
    userId: string;
    code: string;
  }): Promise<ReferralCodeRecord>;
  createReferral(input: {
    id: string;
    referrerUserId: string;
    referredUserId: string;
    code: string;
    rewardCredits: number;
  }): Promise<ReferralRecord>;
  getReferralForReferredUser(referredUserId: string): Promise<ReferralRecord | null>;
  markReferralRewarded(id: string, rewardedAt: Date): Promise<ReferralRecord>;
  getReferralCounts(userId: string): Promise<{
    inviteCount: number;
    rewardedCount: number;
  }>;
  createLedgerEntry(input: {
    id: string;
    userId: string;
    type: RewardLedgerType;
    amountCredits: number;
    relatedUserId?: string | null;
    relatedMatchId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<RewardLedgerEntry>;
  getCreditBalance(userId: string): Promise<number>;
  listLedgerForUser(
    userId: string,
    limit: number,
    offset: number
  ): Promise<RewardLedgerEntry[]>;
  awardBadge(input: {
    id: string;
    userId: string;
    badgeKey: BadgeKey;
    metadata?: Record<string, unknown>;
  }): Promise<{ badge: UserBadge; created: boolean }>;
  listBadgesForUser(userId: string): Promise<UserBadge[]>;
  getProgress(userId: string): Promise<UserProgress | null>;
  createProgress(userId: string): Promise<UserProgress>;
  updateProgress(input: {
    userId: string;
    xpDelta: number;
    reputationDelta: number;
    level: number;
    currentStreak: number;
    longestStreak: number;
    lastActivityDate: string;
  }): Promise<UserProgress>;
  getGamificationEventByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<GamificationEvent | null>;
  createGamificationEvent(input: {
    id: string;
    userId: string;
    eventType: GamificationEventType;
    xpDelta: number;
    reputationDelta: number;
    relatedCampaignId?: string | null;
    relatedMatchId?: string | null;
    idempotencyKey?: string | null;
    metadata?: Record<string, unknown>;
    activityDate: string;
  }): Promise<{ event: GamificationEvent; created: boolean }>;
  getDailyXpForEventType(input: {
    userId: string;
    eventType: GamificationEventType;
    activityDate: string;
  }): Promise<number>;
  listGamificationEventsForUser(
    userId: string,
    limit: number,
    offset: number
  ): Promise<GamificationEvent[]>;
  listLeaderboard(input: {
    role: "creator" | "brand";
    limit: number;
  }): Promise<LeaderboardEntry[]>;
};

export class PostgresRewardsStore implements RewardsStore {
  constructor(private readonly pool: Pool) {}

  async getReferralCodeByUser(userId: string): Promise<ReferralCodeRecord | null> {
    const result = await this.pool.query<ReferralCodeRow>(
      "SELECT * FROM referral_codes WHERE user_id = $1",
      [userId]
    );
    return result.rows[0] ? mapReferralCode(result.rows[0]) : null;
  }

  async getReferralCode(code: string): Promise<ReferralCodeRecord | null> {
    const result = await this.pool.query<ReferralCodeRow>(
      "SELECT * FROM referral_codes WHERE code = $1",
      [code]
    );
    return result.rows[0] ? mapReferralCode(result.rows[0]) : null;
  }

  async createReferralCode(input: {
    userId: string;
    code: string;
  }): Promise<ReferralCodeRecord> {
    const result = await this.pool.query<ReferralCodeRow>(
      `INSERT INTO referral_codes (user_id, code)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET code = referral_codes.code
       RETURNING *`,
      [input.userId, input.code]
    );
    return mapReferralCode(result.rows[0]);
  }

  async createReferral(input: {
    id: string;
    referrerUserId: string;
    referredUserId: string;
    code: string;
    rewardCredits: number;
  }): Promise<ReferralRecord> {
    const result = await this.pool.query<ReferralRow>(
      `INSERT INTO referrals (
         id, referrer_user_id, referred_user_id, code, reward_credits
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.id,
        input.referrerUserId,
        input.referredUserId,
        input.code,
        input.rewardCredits
      ]
    );
    return mapReferral(result.rows[0]);
  }

  async getReferralForReferredUser(
    referredUserId: string
  ): Promise<ReferralRecord | null> {
    const result = await this.pool.query<ReferralRow>(
      "SELECT * FROM referrals WHERE referred_user_id = $1",
      [referredUserId]
    );
    return result.rows[0] ? mapReferral(result.rows[0]) : null;
  }

  async markReferralRewarded(id: string, rewardedAt: Date): Promise<ReferralRecord> {
    const result = await this.pool.query<ReferralRow>(
      `UPDATE referrals
       SET rewarded_at = COALESCE(rewarded_at, $2)
       WHERE id = $1
       RETURNING *`,
      [id, rewardedAt]
    );
    return mapReferral(result.rows[0]);
  }

  async getReferralCounts(userId: string): Promise<{
    inviteCount: number;
    rewardedCount: number;
  }> {
    const result = await this.pool.query<{
      invite_count: string;
      rewarded_count: string;
    }>(
      `SELECT
         count(*)::text AS invite_count,
         count(*) FILTER (WHERE rewarded_at IS NOT NULL)::text AS rewarded_count
       FROM referrals
       WHERE referrer_user_id = $1`,
      [userId]
    );
    return {
      inviteCount: Number(result.rows[0]?.invite_count ?? 0),
      rewardedCount: Number(result.rows[0]?.rewarded_count ?? 0)
    };
  }

  async createLedgerEntry(input: {
    id: string;
    userId: string;
    type: RewardLedgerType;
    amountCredits: number;
    relatedUserId?: string | null;
    relatedMatchId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<RewardLedgerEntry> {
    const result = await this.pool.query<RewardLedgerRow>(
      `INSERT INTO reward_ledger (
         id, user_id, type, amount_credits, related_user_id, related_match_id, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.id,
        input.userId,
        input.type,
        input.amountCredits,
        input.relatedUserId ?? null,
        input.relatedMatchId ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    return mapLedger(result.rows[0]);
  }

  async getCreditBalance(userId: string): Promise<number> {
    const result = await this.pool.query<{ balance: string }>(
      "SELECT COALESCE(sum(amount_credits), 0)::text AS balance FROM reward_ledger WHERE user_id = $1",
      [userId]
    );
    return Number(result.rows[0]?.balance ?? 0);
  }

  async listLedgerForUser(
    userId: string,
    limit: number,
    offset: number
  ): Promise<RewardLedgerEntry[]> {
    const result = await this.pool.query<RewardLedgerRow>(
      `SELECT * FROM reward_ledger
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows.map(mapLedger);
  }

  async awardBadge(input: {
    id: string;
    userId: string;
    badgeKey: BadgeKey;
    metadata?: Record<string, unknown>;
  }): Promise<{ badge: UserBadge; created: boolean }> {
    const result = await this.pool.query<UserBadgeRow>(
      `INSERT INTO user_badges (id, user_id, badge_key, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, badge_key)
       DO UPDATE SET badge_key = user_badges.badge_key
       RETURNING *`,
      [input.id, input.userId, input.badgeKey, JSON.stringify(input.metadata ?? {})]
    );
    return {
      badge: mapBadge(result.rows[0]),
      created: result.rows[0]?.id === input.id
    };
  }

  async listBadgesForUser(userId: string): Promise<UserBadge[]> {
    const result = await this.pool.query<UserBadgeRow>(
      "SELECT * FROM user_badges WHERE user_id = $1 ORDER BY earned_at DESC, id DESC",
      [userId]
    );
    return result.rows.map(mapBadge);
  }

  async getProgress(userId: string): Promise<UserProgress | null> {
    const result = await this.pool.query<UserProgressRow>(
      "SELECT * FROM user_gamification_progress WHERE user_id = $1",
      [userId]
    );
    return result.rows[0] ? mapProgress(result.rows[0]) : null;
  }

  async createProgress(userId: string): Promise<UserProgress> {
    const result = await this.pool.query<UserProgressRow>(
      `INSERT INTO user_gamification_progress (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET user_id = user_gamification_progress.user_id
       RETURNING *`,
      [userId]
    );
    return mapProgress(result.rows[0]);
  }

  async updateProgress(input: {
    userId: string;
    xpDelta: number;
    reputationDelta: number;
    level: number;
    currentStreak: number;
    longestStreak: number;
    lastActivityDate: string;
  }): Promise<UserProgress> {
    const result = await this.pool.query<UserProgressRow>(
      `UPDATE user_gamification_progress
       SET xp = GREATEST(0, xp + $2),
           reputation_score = GREATEST(0, reputation_score + $3),
           level = GREATEST(level, $4),
           current_streak = $5,
           longest_streak = GREATEST(longest_streak, $6),
           last_activity_date = $7::date,
           updated_at = now()
       WHERE user_id = $1
       RETURNING *`,
      [
        input.userId,
        input.xpDelta,
        input.reputationDelta,
        input.level,
        input.currentStreak,
        input.longestStreak,
        input.lastActivityDate
      ]
    );
    return mapProgress(result.rows[0]);
  }

  async getGamificationEventByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<GamificationEvent | null> {
    const result = await this.pool.query<GamificationEventRow>(
      `SELECT * FROM gamification_events
       WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey]
    );
    return result.rows[0] ? mapGamificationEvent(result.rows[0]) : null;
  }

  async createGamificationEvent(input: {
    id: string;
    userId: string;
    eventType: GamificationEventType;
    xpDelta: number;
    reputationDelta: number;
    relatedCampaignId?: string | null;
    relatedMatchId?: string | null;
    idempotencyKey?: string | null;
    metadata?: Record<string, unknown>;
    activityDate: string;
  }): Promise<{ event: GamificationEvent; created: boolean }> {
    const result = await this.pool.query<GamificationEventRow>(
      `INSERT INTO gamification_events (
         id, user_id, event_type, xp_delta, reputation_delta,
         related_campaign_id, related_match_id, idempotency_key, metadata, activity_date
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date)
       ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO UPDATE SET idempotency_key = gamification_events.idempotency_key
       RETURNING *`,
      [
        input.id,
        input.userId,
        input.eventType,
        input.xpDelta,
        input.reputationDelta,
        input.relatedCampaignId ?? null,
        input.relatedMatchId ?? null,
        input.idempotencyKey ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.activityDate
      ]
    );
    return {
      event: mapGamificationEvent(result.rows[0]),
      created: result.rows[0]?.id === input.id
    };
  }

  async getDailyXpForEventType(input: {
    userId: string;
    eventType: GamificationEventType;
    activityDate: string;
  }): Promise<number> {
    const result = await this.pool.query<{ total: string }>(
      `SELECT COALESCE(sum(xp_delta), 0)::text AS total
       FROM gamification_events
       WHERE user_id = $1 AND event_type = $2 AND activity_date = $3::date`,
      [input.userId, input.eventType, input.activityDate]
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  async listGamificationEventsForUser(
    userId: string,
    limit: number,
    offset: number
  ): Promise<GamificationEvent[]> {
    const result = await this.pool.query<GamificationEventRow>(
      `SELECT * FROM gamification_events
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows.map(mapGamificationEvent);
  }

  async listLeaderboard(input: {
    role: "creator" | "brand";
    limit: number;
  }): Promise<LeaderboardEntry[]> {
    const result = await this.pool.query<LeaderboardRow>(
      `SELECT
         users.id AS user_id,
         users.role,
         COALESCE(NULLIF(profiles.display_name, ''), users.email) AS display_name,
         progress.xp,
         progress.level,
         progress.reputation_score,
         progress.current_streak,
         progress.updated_at
       FROM user_gamification_progress AS progress
       INNER JOIN users ON users.id = progress.user_id
       LEFT JOIN profiles ON profiles.user_id = progress.user_id
       WHERE users.role = $1 AND users.status = 'active'
       ORDER BY progress.reputation_score DESC, progress.xp DESC, progress.updated_at DESC
       LIMIT $2`,
      [input.role, input.limit]
    );
    return result.rows.map(mapLeaderboardEntry);
  }
}

type ReferralCodeRow = {
  user_id: string;
  code: string;
  created_at: Date;
};

type ReferralRow = {
  id: string;
  referrer_user_id: string;
  referred_user_id: string;
  code: string;
  reward_credits: number;
  rewarded_at: Date | null;
  created_at: Date;
};

type RewardLedgerRow = {
  id: string;
  user_id: string;
  type: RewardLedgerType;
  amount_credits: number;
  related_user_id: string | null;
  related_match_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
};

type UserBadgeRow = {
  id: string;
  user_id: string;
  badge_key: BadgeKey;
  metadata: Record<string, unknown>;
  earned_at: Date;
};

type UserProgressRow = {
  user_id: string;
  xp: number;
  level: number;
  current_streak: number;
  longest_streak: number;
  last_activity_date: string | Date | null;
  reputation_score: number;
  updated_at: Date;
};

type GamificationEventRow = {
  id: string;
  user_id: string;
  event_type: GamificationEventType;
  xp_delta: number;
  reputation_delta: number;
  related_campaign_id: string | null;
  related_match_id: string | null;
  idempotency_key: string | null;
  metadata: Record<string, unknown>;
  activity_date: string | Date;
  created_at: Date;
};

type LeaderboardRow = {
  user_id: string;
  display_name: string;
  role: "creator" | "brand";
  xp: number;
  level: number;
  reputation_score: number;
  current_streak: number;
  updated_at: Date;
};

function mapReferralCode(row: ReferralCodeRow | undefined): ReferralCodeRecord {
  if (!row) {
    throw new Error("Expected referral code row.");
  }
  return { userId: row.user_id, code: row.code, createdAt: row.created_at };
}

function mapReferral(row: ReferralRow | undefined): ReferralRecord {
  if (!row) {
    throw new Error("Expected referral row.");
  }
  return {
    id: row.id,
    referrerUserId: row.referrer_user_id,
    referredUserId: row.referred_user_id,
    code: row.code,
    rewardCredits: row.reward_credits,
    rewardedAt: row.rewarded_at,
    createdAt: row.created_at
  };
}

function mapLedger(row: RewardLedgerRow | undefined): RewardLedgerEntry {
  if (!row) {
    throw new Error("Expected reward ledger row.");
  }
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    amountCredits: row.amount_credits,
    relatedUserId: row.related_user_id,
    relatedMatchId: row.related_match_id,
    metadata: row.metadata,
    createdAt: row.created_at
  };
}

function mapBadge(row: UserBadgeRow | undefined): UserBadge {
  if (!row) {
    throw new Error("Expected user badge row.");
  }
  return {
    id: row.id,
    userId: row.user_id,
    badgeKey: row.badge_key,
    metadata: row.metadata,
    earnedAt: row.earned_at
  };
}

function mapProgress(row: UserProgressRow | undefined): UserProgress {
  if (!row) {
    throw new Error("Expected user progress row.");
  }
  return {
    userId: row.user_id,
    xp: row.xp,
    level: row.level,
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak,
    lastActivityDate: row.last_activity_date ? toDateKey(row.last_activity_date) : null,
    reputationScore: row.reputation_score,
    updatedAt: row.updated_at
  };
}

function mapGamificationEvent(row: GamificationEventRow | undefined): GamificationEvent {
  if (!row) {
    throw new Error("Expected gamification event row.");
  }
  return {
    id: row.id,
    userId: row.user_id,
    eventType: row.event_type,
    xpDelta: row.xp_delta,
    reputationDelta: row.reputation_delta,
    relatedCampaignId: row.related_campaign_id,
    relatedMatchId: row.related_match_id,
    idempotencyKey: row.idempotency_key,
    metadata: row.metadata,
    activityDate: toDateKey(row.activity_date),
    createdAt: row.created_at
  };
}

function mapLeaderboardEntry(row: LeaderboardRow): LeaderboardEntry {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    role: row.role,
    xp: row.xp,
    level: row.level,
    reputationScore: row.reputation_score,
    currentStreak: row.current_streak,
    updatedAt: row.updated_at
  };
}

function toDateKey(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}
