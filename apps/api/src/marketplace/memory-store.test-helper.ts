import type {
  CampaignFeedFilters,
  CreateCampaignInput,
  CreatorFeedFilters,
  MarketplaceStore,
  UpdateCampaignInput,
  UpsertProfileInput
} from "./store.js";
import type { CampaignCursor, CampaignRecord, ProfileRecord } from "./types.js";
import type {
  InteractionAction,
  MatchRecord,
  RecommendationEventRecord,
  SwipeInteractionRecord,
  TargetType
} from "./types.js";

export class MemoryMarketplaceStore implements MarketplaceStore {
  readonly profiles = new Map<string, ProfileRecord>();
  readonly campaigns = new Map<string, CampaignRecord>();
  readonly interactions = new Map<string, SwipeInteractionRecord>();
  readonly matches = new Map<string, MatchRecord>();
  readonly recommendationEvents: RecommendationEventRecord[] = [];

  async getProfile(userId: string): Promise<ProfileRecord | null> {
    return this.profiles.get(userId) ?? null;
  }

  async upsertProfile(input: UpsertProfileInput): Promise<ProfileRecord> {
    const profile = {
      ...input,
      updatedAt: new Date()
    };
    this.profiles.set(input.userId, profile);
    return profile;
  }

  async createCampaign(input: CreateCampaignInput): Promise<CampaignRecord> {
    const now = new Date();
    const campaign = {
      ...input,
      moderationReason: input.moderationReason ?? null,
      createdAt: now,
      updatedAt: now
    };
    this.campaigns.set(campaign.id, campaign);
    return campaign;
  }

  async getCampaignById(id: string): Promise<CampaignRecord | null> {
    return this.campaigns.get(id) ?? null;
  }

  async listOwnCampaigns(ownerUserId: string): Promise<CampaignRecord[]> {
    return sortCampaigns(
      [...this.campaigns.values()].filter(
        (campaign) => campaign.ownerUserId === ownerUserId
      )
    );
  }

  async listCampaignsForAdmin(input: {
    query: string | null;
    status: CampaignRecord["status"] | null;
    limit: number;
    offset: number;
  }): Promise<CampaignRecord[]> {
    const query = input.query?.toLowerCase() ?? null;

    return sortCampaigns(
      [...this.campaigns.values()].filter((campaign) => {
        if (query) {
          const haystack =
            `${campaign.title} ${campaign.description} ${campaign.categories.join(" ")}`.toLowerCase();

          if (!haystack.includes(query)) {
            return false;
          }
        }
        if (input.status && campaign.status !== input.status) {
          return false;
        }

        return true;
      })
    ).slice(input.offset, input.offset + input.limit);
  }

  async updateCampaign(id: string, input: UpdateCampaignInput): Promise<CampaignRecord> {
    const existing = this.campaigns.get(id);

    if (!existing) {
      throw new Error(`Missing campaign: ${id}`);
    }

    const updated = {
      ...existing,
      ...input,
      moderationReason: input.moderationReason ?? existing.moderationReason,
      targetAudienceAgeMin:
        input.targetAudienceAgeMin === undefined
          ? existing.targetAudienceAgeMin
          : input.targetAudienceAgeMin,
      targetAudienceAgeMax:
        input.targetAudienceAgeMax === undefined
          ? existing.targetAudienceAgeMax
          : input.targetAudienceAgeMax,
      minAudienceSize:
        input.minAudienceSize === undefined
          ? existing.minAudienceSize
          : input.minAudienceSize,
      maxAudienceSize:
        input.maxAudienceSize === undefined
          ? existing.maxAudienceSize
          : input.maxAudienceSize,
      updatedAt: new Date()
    };
    this.campaigns.set(id, updated);
    return updated;
  }

  async listActiveCampaigns(input: {
    cursor: CampaignCursor | null;
    filters: CampaignFeedFilters;
    limit: number;
    excludeActorUserId?: string;
  }): Promise<CampaignRecord[]> {
    return sortCampaigns(
      [...this.campaigns.values()].filter((campaign) => {
        if (campaign.status !== "active") {
          return false;
        }
        if (
          input.excludeActorUserId &&
          this.hasHandledTarget(input.excludeActorUserId, "campaign", campaign.id)
        ) {
          return false;
        }
        if (!campaignMatchesFilters(campaign, input.filters)) {
          return false;
        }
        if (!input.cursor) {
          return true;
        }

        return (
          campaign.createdAt.getTime() < input.cursor.createdAt.getTime() ||
          (campaign.createdAt.getTime() === input.cursor.createdAt.getTime() &&
            campaign.id < input.cursor.id)
        );
      })
    ).slice(0, input.limit);
  }

  async listActiveCampaignCandidates(input: {
    filters: CampaignFeedFilters;
    limit: number;
    excludeActorUserId?: string;
  }): Promise<CampaignRecord[]> {
    return sortCampaigns(
      [...this.campaigns.values()].filter((campaign) => {
        if (campaign.status !== "active") {
          return false;
        }
        if (
          input.excludeActorUserId &&
          this.hasHandledTarget(input.excludeActorUserId, "campaign", campaign.id)
        ) {
          return false;
        }

        return campaignMatchesFilters(campaign, input.filters);
      })
    ).slice(0, input.limit);
  }

  async listCreatorProfiles(input: {
    cursor: CampaignCursor | null;
    filters: CreatorFeedFilters;
    limit: number;
    excludeActorUserId: string;
  }): Promise<ProfileRecord[]> {
    return sortProfiles(
      [...this.profiles.values()].filter((profile) => {
        if (profile.role !== "creator" || profile.userId === input.excludeActorUserId) {
          return false;
        }
        if (this.hasHandledTarget(input.excludeActorUserId, "profile", profile.userId)) {
          return false;
        }
        if (!profileMatchesFilters(profile, input.filters)) {
          return false;
        }
        if (!input.cursor) {
          return true;
        }

        return (
          profile.updatedAt.getTime() < input.cursor.createdAt.getTime() ||
          (profile.updatedAt.getTime() === input.cursor.createdAt.getTime() &&
            profile.userId < input.cursor.id)
        );
      })
    ).slice(0, input.limit);
  }

  async listCreatorProfileCandidates(input: {
    filters: CreatorFeedFilters;
    limit: number;
    excludeActorUserId: string;
  }): Promise<ProfileRecord[]> {
    return sortProfiles(
      [...this.profiles.values()].filter((profile) => {
        if (profile.role !== "creator" || profile.userId === input.excludeActorUserId) {
          return false;
        }
        if (this.hasHandledTarget(input.excludeActorUserId, "profile", profile.userId)) {
          return false;
        }

        return profileMatchesFilters(profile, input.filters);
      })
    ).slice(0, input.limit);
  }

  async upsertInteraction(input: {
    id: string;
    actorUserId: string;
    targetType: TargetType;
    targetId: string;
    action: InteractionAction;
  }): Promise<{ interaction: SwipeInteractionRecord; created: boolean }> {
    const key = interactionKey(input);
    const existing = this.interactions.get(key);

    if (existing) {
      return { interaction: existing, created: false };
    }

    const interaction = {
      ...input,
      createdAt: new Date()
    };
    this.interactions.set(key, interaction);
    return { interaction, created: true };
  }

  async findInteraction(input: {
    actorUserId: string;
    targetType: TargetType;
    targetId: string;
    action: InteractionAction;
  }): Promise<SwipeInteractionRecord | null> {
    return this.interactions.get(interactionKey(input)) ?? null;
  }

  async listInteractionsForActor(actorUserId: string): Promise<SwipeInteractionRecord[]> {
    return [...this.interactions.values()]
      .filter((interaction) => interaction.actorUserId === actorUserId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async listSavedCampaigns(actorUserId: string): Promise<CampaignRecord[]> {
    return this.savedTargets(actorUserId, "campaign")
      .map((interaction) => this.campaigns.get(interaction.targetId))
      .filter((campaign): campaign is CampaignRecord => campaign !== undefined);
  }

  async listSavedProfiles(actorUserId: string): Promise<ProfileRecord[]> {
    return this.savedTargets(actorUserId, "profile")
      .map((interaction) => this.profiles.get(interaction.targetId))
      .filter((profile): profile is ProfileRecord => profile !== undefined);
  }

  async listLikedActiveCampaignsForBrandAndCreator(input: {
    brandUserId: string;
    creatorUserId: string;
  }): Promise<CampaignRecord[]> {
    return sortCampaigns(
      [...this.interactions.values()]
        .filter(
          (interaction) =>
            interaction.actorUserId === input.creatorUserId &&
            interaction.targetType === "campaign" &&
            interaction.action === "like"
        )
        .map((interaction) => this.campaigns.get(interaction.targetId))
        .filter(
          (campaign): campaign is CampaignRecord =>
            campaign !== undefined &&
            campaign.ownerUserId === input.brandUserId &&
            campaign.status === "active"
        )
    );
  }

  async createMatch(input: {
    id: string;
    creatorUserId: string;
    brandUserId: string;
    campaignId: string;
  }): Promise<{ match: MatchRecord; created: boolean }> {
    const key = `${input.creatorUserId}:${input.brandUserId}:${input.campaignId}`;
    const existing = this.matches.get(key);

    if (existing) {
      return { match: existing, created: false };
    }

    const match: MatchRecord = {
      ...input,
      status: "active",
      createdAt: new Date()
    };
    this.matches.set(key, match);
    return { match, created: true };
  }

  async listMatchesForUser(userId: string): Promise<MatchRecord[]> {
    return [...this.matches.values()]
      .filter((match) => match.creatorUserId === userId || match.brandUserId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async createRecommendationEvents(
    input: Array<{
      id: string;
      actorUserId: string;
      feedType: "campaigns" | "creators";
      targetType: TargetType;
      targetId: string;
      score: number;
      rank: number;
      reasons: string[];
    }>
  ): Promise<void> {
    this.recommendationEvents.push(
      ...input.map((event) => ({ ...event, createdAt: new Date() }))
    );
  }

  private hasHandledTarget(
    actorUserId: string,
    targetType: TargetType,
    targetId: string
  ): boolean {
    return ["like", "dislike"].some((action) =>
      this.interactions.has(
        interactionKey({
          actorUserId,
          targetType,
          targetId,
          action: action as InteractionAction
        })
      )
    );
  }

  private savedTargets(
    actorUserId: string,
    targetType: TargetType
  ): SwipeInteractionRecord[] {
    return [...this.interactions.values()]
      .filter(
        (interaction) =>
          interaction.actorUserId === actorUserId &&
          interaction.targetType === targetType &&
          interaction.action === "save"
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }
}

function sortCampaigns(campaigns: CampaignRecord[]): CampaignRecord[] {
  return campaigns.sort((left, right) => {
    const byDate = right.createdAt.getTime() - left.createdAt.getTime();

    if (byDate !== 0) {
      return byDate;
    }

    return right.id.localeCompare(left.id);
  });
}

function sortProfiles(profiles: ProfileRecord[]): ProfileRecord[] {
  return profiles.sort((left, right) => {
    const byDate = right.updatedAt.getTime() - left.updatedAt.getTime();

    if (byDate !== 0) {
      return byDate;
    }

    return right.userId.localeCompare(left.userId);
  });
}

function campaignMatchesFilters(
  campaign: CampaignRecord,
  filters: CampaignFeedFilters
): boolean {
  if (filters.category && !campaign.categories.includes(filters.category)) {
    return false;
  }
  if (filters.budgetMinCents !== null && campaign.budgetCents < filters.budgetMinCents) {
    return false;
  }
  if (filters.budgetMaxCents !== null && campaign.budgetCents > filters.budgetMaxCents) {
    return false;
  }
  if (
    filters.language &&
    campaign.language !== filters.language &&
    campaign.language !== "both"
  ) {
    return false;
  }
  if (filters.format && campaign.contentFormat !== filters.format) {
    return false;
  }
  if (filters.region && !campaign.targetRegions.includes(filters.region)) {
    return false;
  }
  if (filters.platform && !campaign.targetPlatforms.includes(filters.platform)) {
    return false;
  }

  return true;
}

function profileMatchesFilters(
  profile: ProfileRecord,
  filters: CreatorFeedFilters
): boolean {
  if (filters.niche && !profile.niches.includes(filters.niche)) {
    return false;
  }
  if (filters.language && !profile.languages.includes(filters.language)) {
    return false;
  }
  if (filters.region && !profile.regions.includes(filters.region)) {
    return false;
  }
  if (filters.platform && !profile.platforms.includes(filters.platform)) {
    return false;
  }
  if (
    filters.audienceMin !== null &&
    (profile.audienceSize === null || profile.audienceSize < filters.audienceMin)
  ) {
    return false;
  }
  if (
    filters.audienceMax !== null &&
    (profile.audienceSize === null || profile.audienceSize > filters.audienceMax)
  ) {
    return false;
  }

  return true;
}

function interactionKey(input: {
  actorUserId: string;
  targetType: TargetType;
  targetId: string;
  action: InteractionAction;
}): string {
  return `${input.actorUserId}:${input.targetType}:${input.targetId}:${input.action}`;
}
