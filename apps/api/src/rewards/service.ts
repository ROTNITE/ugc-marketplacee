import { randomUUID } from "node:crypto";
import { AuthError, authErrors } from "../auth/errors.js";
import type {
  BadgeKey,
  GamificationEvent,
  GamificationEventType,
  LeaderboardEntry,
  ReferralSummary,
  RewardLedgerEntry,
  UserBadge,
  UserProgress
} from "./types.js";
import type { RewardsStore } from "./store.js";

export const levelThresholds = [0, 100, 250, 500, 1000, 1750, 2750, 4000, 6000, 8500];

export class RewardsService {
  constructor(
    private readonly store: RewardsStore,
    private readonly config: { referralSignupBonusCredits: number },
    private readonly now: () => Date = () => new Date()
  ) {}

  async initializeUser(userId: string, referralCode?: unknown): Promise<void> {
    await this.ensureReferralCode(userId);

    if (referralCode === undefined || referralCode === null || referralCode === "") {
      return;
    }

    const code = parseReferralCode(referralCode);
    const referralCodeRecord = await this.store.getReferralCode(code);

    if (!referralCodeRecord || referralCodeRecord.userId === userId) {
      throw new AuthError("INVALID_REFERRAL_CODE", "Referral code is invalid.", 400);
    }

    const existing = await this.store.getReferralForReferredUser(userId);

    if (existing) {
      throw new AuthError("REFERRAL_EXISTS", "Referral is already recorded.", 400);
    }

    await this.store.createReferral({
      id: randomUUID(),
      referrerUserId: referralCodeRecord.userId,
      referredUserId: userId,
      code,
      rewardCredits: this.config.referralSignupBonusCredits
    });
  }

  async validateReferralCode(referralCode?: unknown): Promise<void> {
    if (referralCode === undefined || referralCode === null || referralCode === "") {
      return;
    }

    const code = parseReferralCode(referralCode);
    const referralCodeRecord = await this.store.getReferralCode(code);

    if (!referralCodeRecord) {
      throw new AuthError("INVALID_REFERRAL_CODE", "Referral code is invalid.", 400);
    }
  }

  async rewardVerifiedReferral(userId: string): Promise<void> {
    const referral = await this.store.getReferralForReferredUser(userId);

    if (!referral || referral.rewardedAt) {
      return;
    }

    await this.store.createLedgerEntry({
      id: randomUUID(),
      userId: referral.referrerUserId,
      type: "referral_bonus",
      amountCredits: referral.rewardCredits,
      relatedUserId: referral.referredUserId,
      metadata: { referralId: referral.id, side: "referrer" }
    });
    await this.store.createLedgerEntry({
      id: randomUUID(),
      userId: referral.referredUserId,
      type: "referral_bonus",
      amountCredits: referral.rewardCredits,
      relatedUserId: referral.referrerUserId,
      metadata: { referralId: referral.id, side: "referred" }
    });
    await this.store.markReferralRewarded(referral.id, new Date());
  }

  async getReferralSummary(userId: string): Promise<ReferralSummary> {
    const code = await this.ensureReferralCode(userId);
    const counts = await this.store.getReferralCounts(userId);

    return {
      code: code.code,
      inviteCount: counts.inviteCount,
      rewardedCount: counts.rewardedCount,
      creditBalance: await this.store.getCreditBalance(userId)
    };
  }

  async listLedger(
    userId: string,
    query: { limit?: unknown; offset?: unknown }
  ): Promise<{ entries: RewardLedgerEntry[]; creditBalance: number }> {
    return {
      entries: await this.store.listLedgerForUser(
        userId,
        parseInteger(query.limit, 50, 1, 100),
        parseInteger(query.offset, 0, 0, 10000)
      ),
      creditBalance: await this.store.getCreditBalance(userId)
    };
  }

  async listBadges(userId: string): Promise<{ badges: UserBadge[] }> {
    return { badges: await this.store.listBadgesForUser(userId) };
  }

  async getGamificationSummary(userId: string): Promise<{
    progress: UserProgress;
    badges: UserBadge[];
    events: GamificationEvent[];
    creditBalance: number;
    nextLevelXp: number | null;
  }> {
    const progress = await this.ensureProgress(userId);

    return {
      progress,
      badges: await this.store.listBadgesForUser(userId),
      events: await this.store.listGamificationEventsForUser(userId, 20, 0),
      creditBalance: await this.store.getCreditBalance(userId),
      nextLevelXp: levelThresholds[progress.level] ?? null
    };
  }

  async listLeaderboard(query: { role?: unknown; limit?: unknown }): Promise<{
    entries: LeaderboardEntry[];
  }> {
    const role = query.role === "brand" ? "brand" : "creator";
    return {
      entries: await this.store.listLeaderboard({
        role,
        limit: parseInteger(query.limit, 20, 1, 50)
      })
    };
  }

  async awardProfileCompleted(userId: string): Promise<void> {
    await this.recordGamificationEvent({
      userId,
      eventType: "profile_completed",
      xpDelta: 20,
      reputationDelta: 0,
      idempotencyKey: "profile_completed",
      badgeKeys: ["profile_completed"]
    });
  }

  async awardCampaignPosted(userId: string, campaignId: string): Promise<void> {
    await this.recordGamificationEvent({
      userId,
      eventType: "campaign_posted",
      xpDelta: 30,
      reputationDelta: 0,
      relatedCampaignId: campaignId,
      idempotencyKey: `campaign_posted:${campaignId}`,
      badgeKeys: ["first_campaign_posted"]
    });
  }

  async awardSwipeAction(input: {
    userId: string;
    targetType: string;
    targetId: string;
    action: string;
  }): Promise<void> {
    const activityDate = todayKey(this.now());
    const dailyXp = await this.store.getDailyXpForEventType({
      userId: input.userId,
      eventType: "swipe_action",
      activityDate
    });
    const xpDelta = Math.max(0, Math.min(1, 20 - dailyXp));

    await this.recordGamificationEvent({
      userId: input.userId,
      eventType: "swipe_action",
      xpDelta,
      reputationDelta: 0,
      idempotencyKey: `swipe_action:${input.targetType}:${input.targetId}:${input.action}`,
      metadata: {
        targetType: input.targetType,
        targetId: input.targetId,
        action: input.action
      },
      badgeKeys: ["first_swipe"],
      activityDate
    });
  }

  async awardMatchCreated(input: {
    matchId: string;
    campaignId: string;
    creatorUserId: string;
    brandUserId: string;
  }): Promise<void> {
    await Promise.all([
      this.recordGamificationEvent({
        userId: input.creatorUserId,
        eventType: "match_created",
        xpDelta: 50,
        reputationDelta: 0,
        relatedCampaignId: input.campaignId,
        relatedMatchId: input.matchId,
        idempotencyKey: `match_created:${input.matchId}`,
        badgeKeys: ["first_match"]
      }),
      this.recordGamificationEvent({
        userId: input.brandUserId,
        eventType: "match_created",
        xpDelta: 50,
        reputationDelta: 0,
        relatedCampaignId: input.campaignId,
        relatedMatchId: input.matchId,
        idempotencyKey: `match_created:${input.matchId}`,
        badgeKeys: ["first_match"]
      })
    ]);
  }

  async awardEscrowFunded(
    brandUserId: string,
    input: { matchId: string; campaignId: string }
  ): Promise<void> {
    await this.recordGamificationEvent({
      userId: brandUserId,
      eventType: "escrow_funded",
      xpDelta: 40,
      reputationDelta: 0,
      relatedCampaignId: input.campaignId,
      relatedMatchId: input.matchId,
      idempotencyKey: `escrow_funded:${input.matchId}`,
      badgeKeys: ["first_match_funded"]
    });
  }

  async awardCampaignCompleted(
    creatorUserId: string,
    input: { matchId: string; campaignId: string }
  ): Promise<void> {
    await this.recordGamificationEvent({
      userId: creatorUserId,
      eventType: "campaign_completed",
      xpDelta: 100,
      reputationDelta: 100,
      relatedCampaignId: input.campaignId,
      relatedMatchId: input.matchId,
      idempotencyKey: `campaign_completed:${input.matchId}`,
      badgeKeys: ["first_completed_campaign"]
    });
  }

  async awardBadge(
    userId: string,
    badgeKey: BadgeKey,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    await this.store.awardBadge({
      id: randomUUID(),
      userId,
      badgeKey,
      metadata
    });
  }

  async applyCredits(
    userId: string,
    maxCredits: number,
    metadata: Record<string, unknown>
  ): Promise<number> {
    const normalizedMax = Math.max(0, Math.floor(maxCredits));

    if (normalizedMax === 0) {
      return 0;
    }

    const balance = await this.store.getCreditBalance(userId);
    const applied = Math.min(balance, normalizedMax);

    if (applied <= 0) {
      return 0;
    }

    await this.store.createLedgerEntry({
      id: randomUUID(),
      userId,
      type: "credit_spent",
      amountCredits: -applied,
      relatedMatchId: typeof metadata.matchId === "string" ? metadata.matchId : undefined,
      metadata
    });

    return applied;
  }

  private async ensureProgress(userId: string): Promise<UserProgress> {
    return (await this.store.getProgress(userId)) ?? this.store.createProgress(userId);
  }

  private async recordGamificationEvent(input: {
    userId: string;
    eventType: GamificationEventType;
    xpDelta: number;
    reputationDelta: number;
    relatedCampaignId?: string | null;
    relatedMatchId?: string | null;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
    badgeKeys?: BadgeKey[];
    activityDate?: string;
  }): Promise<void> {
    const activityDate = input.activityDate ?? todayKey(this.now());
    const existing = await this.store.getGamificationEventByIdempotencyKey(
      input.userId,
      input.idempotencyKey
    );

    if (existing) {
      return;
    }

    const progress = await this.ensureProgress(input.userId);
    const streak = nextStreak(progress, activityDate);
    const event = await this.store.createGamificationEvent({
      id: randomUUID(),
      userId: input.userId,
      eventType: input.eventType,
      xpDelta: input.xpDelta,
      reputationDelta: input.reputationDelta,
      relatedCampaignId: input.relatedCampaignId,
      relatedMatchId: input.relatedMatchId,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
      activityDate
    });

    if (!event.created) {
      return;
    }

    const nextXp = progress.xp + input.xpDelta;
    const updated = await this.store.updateProgress({
      userId: input.userId,
      xpDelta: input.xpDelta,
      reputationDelta: input.reputationDelta,
      level: levelForXp(nextXp),
      currentStreak: streak.current,
      longestStreak: streak.longest,
      lastActivityDate: activityDate
    });

    for (const badgeKey of input.badgeKeys ?? []) {
      await this.awardBadge(input.userId, badgeKey, {
        eventType: input.eventType,
        relatedCampaignId: input.relatedCampaignId,
        relatedMatchId: input.relatedMatchId
      });
    }
    if (updated.currentStreak >= 3) {
      await this.awardBadge(input.userId, "streak_3", { streak: updated.currentStreak });
    }
    if (updated.currentStreak >= 7) {
      await this.awardBadge(input.userId, "streak_7", { streak: updated.currentStreak });
    }
    if (updated.level >= 5) {
      await this.awardBadge(input.userId, "level_5", { level: updated.level });
    }
    if (updated.level >= 10) {
      await this.awardBadge(input.userId, "level_10", { level: updated.level });
    }
  }

  private async ensureReferralCode(userId: string) {
    const existing = await this.store.getReferralCodeByUser(userId);

    if (existing) {
      return existing;
    }

    for (let index = 0; index < 5; index += 1) {
      const code = createReferralCode();
      const taken = await this.store.getReferralCode(code);

      if (!taken) {
        return this.store.createReferralCode({ userId, code });
      }
    }

    return this.store.createReferralCode({
      userId,
      code: `${createReferralCode()}${Date.now()}`
    });
  }
}

export function levelForXp(xp: number): number {
  let level = 1;

  for (const threshold of levelThresholds) {
    if (xp >= threshold) {
      level += 1;
    }
  }

  return Math.max(1, level - 1);
}

function todayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nextStreak(
  progress: UserProgress,
  activityDate: string
): { current: number; longest: number } {
  if (progress.lastActivityDate === activityDate) {
    return {
      current: Math.max(1, progress.currentStreak),
      longest: Math.max(progress.longestStreak, progress.currentStreak, 1)
    };
  }

  const yesterday = new Date(`${activityDate}T00:00:00.000Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const expectedPrevious = todayKey(yesterday);
  const current =
    progress.lastActivityDate === expectedPrevious ? progress.currentStreak + 1 : 1;

  return {
    current,
    longest: Math.max(progress.longestStreak, current)
  };
}

function createReferralCode(): string {
  return randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
}

function parseReferralCode(value: unknown): string {
  if (typeof value !== "string") {
    throw authErrors.invalidPayload();
  }

  const code = value.trim().toUpperCase();

  if (!/^[A-Z0-9]{4,32}$/.test(code)) {
    throw authErrors.invalidPayload();
  }

  return code;
}

function parseInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const number = Number(value ?? fallback);

  if (!Number.isInteger(number) || number < min || number > max) {
    throw authErrors.invalidPayload();
  }

  return number;
}
