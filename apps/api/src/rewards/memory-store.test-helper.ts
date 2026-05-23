import type { RewardsStore } from "./store.js";
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

export class MemoryRewardsStore implements RewardsStore {
  readonly referralCodes = new Map<string, ReferralCodeRecord>();
  readonly referrals = new Map<string, ReferralRecord>();
  readonly ledger = new Map<string, RewardLedgerEntry>();
  readonly badges = new Map<string, UserBadge>();
  readonly progress = new Map<string, UserProgress>();
  readonly gamificationEvents = new Map<string, GamificationEvent>();
  readonly leaderboardProfiles = new Map<
    string,
    { displayName: string; role: "creator" | "brand" }
  >();

  async getReferralCodeByUser(userId: string): Promise<ReferralCodeRecord | null> {
    return this.referralCodes.get(userId) ?? null;
  }

  async getReferralCode(code: string): Promise<ReferralCodeRecord | null> {
    return (
      [...this.referralCodes.values()].find((record) => record.code === code) ?? null
    );
  }

  async createReferralCode(input: {
    userId: string;
    code: string;
  }): Promise<ReferralCodeRecord> {
    const existing = this.referralCodes.get(input.userId);

    if (existing) {
      return existing;
    }

    const record = { ...input, createdAt: new Date() };
    this.referralCodes.set(input.userId, record);
    return record;
  }

  async createReferral(input: {
    id: string;
    referrerUserId: string;
    referredUserId: string;
    code: string;
    rewardCredits: number;
  }): Promise<ReferralRecord> {
    const existing = await this.getReferralForReferredUser(input.referredUserId);

    if (existing) {
      throw new Error("Duplicate referral");
    }

    const referral = {
      ...input,
      rewardedAt: null,
      createdAt: new Date()
    };
    this.referrals.set(referral.id, referral);
    return referral;
  }

  async getReferralForReferredUser(
    referredUserId: string
  ): Promise<ReferralRecord | null> {
    return (
      [...this.referrals.values()].find(
        (referral) => referral.referredUserId === referredUserId
      ) ?? null
    );
  }

  async markReferralRewarded(id: string, rewardedAt: Date): Promise<ReferralRecord> {
    const referral = this.referrals.get(id);

    if (!referral) {
      throw new Error("Missing referral");
    }

    const next = { ...referral, rewardedAt: referral.rewardedAt ?? rewardedAt };
    this.referrals.set(id, next);
    return next;
  }

  async getReferralCounts(userId: string): Promise<{
    inviteCount: number;
    rewardedCount: number;
  }> {
    const referrals = [...this.referrals.values()].filter(
      (referral) => referral.referrerUserId === userId
    );
    return {
      inviteCount: referrals.length,
      rewardedCount: referrals.filter((referral) => referral.rewardedAt).length
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
    const entry = {
      id: input.id,
      userId: input.userId,
      type: input.type,
      amountCredits: input.amountCredits,
      relatedUserId: input.relatedUserId ?? null,
      relatedMatchId: input.relatedMatchId ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date()
    };
    this.ledger.set(entry.id, entry);
    return entry;
  }

  async getCreditBalance(userId: string): Promise<number> {
    return [...this.ledger.values()]
      .filter((entry) => entry.userId === userId)
      .reduce((sum, entry) => sum + entry.amountCredits, 0);
  }

  async listLedgerForUser(
    userId: string,
    limit: number,
    offset: number
  ): Promise<RewardLedgerEntry[]> {
    return [...this.ledger.values()]
      .filter((entry) => entry.userId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(offset, offset + limit);
  }

  async awardBadge(input: {
    id: string;
    userId: string;
    badgeKey: BadgeKey;
    metadata?: Record<string, unknown>;
  }): Promise<{ badge: UserBadge; created: boolean }> {
    const key = `${input.userId}:${input.badgeKey}`;
    const existing = this.badges.get(key);

    if (existing) {
      return { badge: existing, created: false };
    }

    const badge = {
      id: input.id,
      userId: input.userId,
      badgeKey: input.badgeKey,
      metadata: input.metadata ?? {},
      earnedAt: new Date()
    };
    this.badges.set(key, badge);
    return { badge, created: true };
  }

  async listBadgesForUser(userId: string): Promise<UserBadge[]> {
    return [...this.badges.values()]
      .filter((badge) => badge.userId === userId)
      .sort((left, right) => right.earnedAt.getTime() - left.earnedAt.getTime());
  }

  async getProgress(userId: string): Promise<UserProgress | null> {
    return this.progress.get(userId) ?? null;
  }

  async createProgress(userId: string): Promise<UserProgress> {
    const existing = this.progress.get(userId);

    if (existing) {
      return existing;
    }

    const record = {
      userId,
      xp: 0,
      level: 1,
      currentStreak: 0,
      longestStreak: 0,
      lastActivityDate: null,
      reputationScore: 0,
      updatedAt: new Date()
    };
    this.progress.set(userId, record);
    return record;
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
    const existing = await this.createProgress(input.userId);
    const updated = {
      ...existing,
      xp: Math.max(0, existing.xp + input.xpDelta),
      level: Math.max(existing.level, input.level),
      currentStreak: input.currentStreak,
      longestStreak: Math.max(existing.longestStreak, input.longestStreak),
      lastActivityDate: input.lastActivityDate,
      reputationScore: Math.max(0, existing.reputationScore + input.reputationDelta),
      updatedAt: new Date()
    };
    this.progress.set(input.userId, updated);
    return updated;
  }

  async getGamificationEventByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<GamificationEvent | null> {
    return (
      [...this.gamificationEvents.values()].find(
        (event) => event.userId === userId && event.idempotencyKey === idempotencyKey
      ) ?? null
    );
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
    if (input.idempotencyKey) {
      const existing = await this.getGamificationEventByIdempotencyKey(
        input.userId,
        input.idempotencyKey
      );

      if (existing) {
        return { event: existing, created: false };
      }
    }

    const event = {
      id: input.id,
      userId: input.userId,
      eventType: input.eventType,
      xpDelta: input.xpDelta,
      reputationDelta: input.reputationDelta,
      relatedCampaignId: input.relatedCampaignId ?? null,
      relatedMatchId: input.relatedMatchId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      metadata: input.metadata ?? {},
      activityDate: input.activityDate,
      createdAt: new Date()
    };
    this.gamificationEvents.set(event.id, event);
    return { event, created: true };
  }

  async getDailyXpForEventType(input: {
    userId: string;
    eventType: GamificationEventType;
    activityDate: string;
  }): Promise<number> {
    return [...this.gamificationEvents.values()]
      .filter(
        (event) =>
          event.userId === input.userId &&
          event.eventType === input.eventType &&
          event.activityDate === input.activityDate
      )
      .reduce((sum, event) => sum + event.xpDelta, 0);
  }

  async listGamificationEventsForUser(
    userId: string,
    limit: number,
    offset: number
  ): Promise<GamificationEvent[]> {
    return [...this.gamificationEvents.values()]
      .filter((event) => event.userId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(offset, offset + limit);
  }

  async listLeaderboard(input: {
    role: "creator" | "brand";
    limit: number;
  }): Promise<LeaderboardEntry[]> {
    return [...this.progress.values()]
      .map((progress) => {
        const profile = this.leaderboardProfiles.get(progress.userId);
        return {
          userId: progress.userId,
          displayName: profile?.displayName ?? "User",
          role: profile?.role ?? input.role,
          xp: progress.xp,
          level: progress.level,
          reputationScore: progress.reputationScore,
          currentStreak: progress.currentStreak,
          updatedAt: progress.updatedAt
        };
      })
      .filter((entry) => entry.role === input.role)
      .sort(
        (left, right) =>
          right.reputationScore - left.reputationScore ||
          right.xp - left.xp ||
          right.updatedAt.getTime() - left.updatedAt.getTime()
      )
      .slice(0, input.limit);
  }
}
