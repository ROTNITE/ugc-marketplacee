import { randomUUID } from "node:crypto";
import { AuthError, authErrors } from "../auth/errors.js";
import type { ApiConfig } from "../config.js";
import type { AccessTokenClaims } from "../auth/security.js";
import type { UserRole } from "../auth/types.js";
import type { RewardsService } from "../rewards/service.js";
import type { Notifier } from "../notifications/notifier.js";
import { NoopNotifier } from "../notifications/notifier.js";
import type {
  CampaignFeedFilters,
  CreatorFeedFilters,
  MarketplaceStore,
  UpdateCampaignInput
} from "./store.js";
import type {
  CampaignFeedPage,
  CampaignRecord,
  CampaignStatus,
  ContentFormat,
  ContentLanguage,
  CreatorProfileFeedPage,
  FavoritesPage,
  InteractionAction,
  MatchRecord,
  MatchSummary,
  MediaType,
  ProfileRecord,
  SocialLinks,
  SocialPlatform,
  TargetType
} from "./types.js";
import {
  applyRecommendationCursor,
  encodeRecommendationCursor,
  parseRecommendationCursor,
  scoreCampaignsForCreator,
  scoreCreatorsForBrand,
  sortRecommended,
  type Scored
} from "./recommendations.js";

const recommendationCandidateLimit = 250;

const socialPlatforms = [
  "youtube",
  "tiktok",
  "instagram",
  "vk",
  "telegram",
  "website"
] as const satisfies readonly SocialPlatform[];

const allowedStatuses = ["draft", "active", "paused", "archived", "rejected"] as const;
const allowedLanguages = [
  "ru",
  "en",
  "both"
] as const satisfies readonly ContentLanguage[];
const allowedFormats = [
  "short_video",
  "long_video",
  "review",
  "demo"
] as const satisfies readonly ContentFormat[];

export class MarketplaceService {
  private readonly notifier: Notifier;
  constructor(
    private readonly store: MarketplaceStore,
    private readonly config: Pick<ApiConfig, "bannedKeywords"> = {
      bannedKeywords: []
    },
    private readonly rewardsService?: RewardsService,
    notifier?: Notifier
  ) {
    this.notifier = notifier ?? new NoopNotifier();
  }

  async getMyProfile(auth: AccessTokenClaims): Promise<ProfileRecord> {
    const existing = await this.store.getProfile(auth.sub);

    if (existing) {
      return existing;
    }

    return {
      userId: auth.sub,
      role: toUserRole(auth.role),
      displayName: "",
      avatarUrl: null,
      bio: "",
      socialLinks: {},
      niches: [],
      languages: [],
      regions: [],
      platforms: [],
      audienceSize: null,
      audienceAgeMin: null,
      audienceAgeMax: null,
      updatedAt: new Date(0)
    };
  }

  async saveMyProfile(auth: AccessTokenClaims, body: unknown): Promise<ProfileRecord> {
    const input = parseProfileInput(body);
    const profile = await this.store.upsertProfile({
      userId: auth.sub,
      role: toUserRole(auth.role),
      ...input
    });

    if (isProfileComplete(profile)) {
      await this.rewardsService?.awardProfileCompleted(auth.sub);
    }

    return profile;
  }

  async listMyCampaigns(auth: AccessTokenClaims): Promise<CampaignRecord[]> {
    requireRole(auth, "brand");
    return this.store.listOwnCampaigns(auth.sub);
  }

  async createCampaign(auth: AccessTokenClaims, body: unknown): Promise<CampaignRecord> {
    requireRole(auth, "brand");
    const input = this.applyModeration(parseCampaignInput(body, null));
    const campaign = await this.store.createCampaign({
      id: randomUUID(),
      ownerUserId: auth.sub,
      ...input
    });

    await this.rewardsService?.awardCampaignPosted(auth.sub, campaign.id);

    return campaign;
  }

  async getCampaign(auth: AccessTokenClaims, id: string): Promise<CampaignRecord> {
    const campaign = await this.store.getCampaignById(id);

    if (!campaign) {
      throw marketplaceErrors.notFound();
    }

    if (campaign.status === "active" || campaign.ownerUserId === auth.sub) {
      return campaign;
    }

    throw marketplaceErrors.notFound();
  }

  async updateCampaign(
    auth: AccessTokenClaims,
    id: string,
    body: unknown
  ): Promise<CampaignRecord> {
    requireRole(auth, "brand");
    const campaign = await this.store.getCampaignById(id);

    if (!campaign) {
      throw marketplaceErrors.notFound();
    }
    if (campaign.ownerUserId !== auth.sub) {
      throw marketplaceErrors.forbidden();
    }

    const input = this.applyModeration(parseCampaignInput(body, campaign));
    return this.store.updateCampaign(id, input);
  }

  async listFeed(auth: AccessTokenClaims, query: { cursor?: unknown; limit?: unknown }) {
    requireRole(auth, "creator");
    const limit = parseLimit(query.limit);
    const cursor = parseRecommendationFeedCursor(query.cursor);
    const filters = parseCampaignFeedFilters(query);
    const campaigns = await this.store.listActiveCampaignCandidates({
      filters,
      limit: recommendationCandidateLimit,
      excludeActorUserId: auth.sub
    });
    const creatorProfile = await this.store.getProfile(auth.sub);
    const interactions = await this.store.listInteractionsForActor(auth.sub);
    const interactedCampaigns = await this.getInteractedCampaigns(interactions);
    const matchedCampaigns = await this.getMatchedCampaigns(auth.sub);
    const ranked = sortRecommended(
      scoreCampaignsForCreator({
        campaigns,
        creatorProfile,
        interactions,
        interactedCampaigns,
        matchedCampaigns
      })
    );
    const paged = applyRecommendationCursor(ranked, cursor);
    const visible = paged.slice(0, limit);
    const hasMore = paged.length > limit;

    await this.recordRecommendationEvents(
      auth.sub,
      "campaigns",
      "campaign",
      ranked,
      visible
    );

    return {
      campaigns: visible,
      nextCursor: hasMore ? encodeRecommendationCursor(visible[visible.length - 1]) : null
    } satisfies CampaignFeedPage;
  }

  async listCreatorFeed(
    auth: AccessTokenClaims,
    query: { cursor?: unknown; limit?: unknown }
  ) {
    requireRole(auth, "brand");
    const limit = parseLimit(query.limit);
    const cursor = parseRecommendationFeedCursor(query.cursor);
    const profiles = await this.store.listCreatorProfileCandidates({
      filters: parseCreatorFeedFilters(query),
      limit: recommendationCandidateLimit,
      excludeActorUserId: auth.sub
    });
    const interactions = await this.store.listInteractionsForActor(auth.sub);
    const interactedProfiles = await this.getInteractedProfiles(interactions);
    const brandCampaigns = await this.store.listOwnCampaigns(auth.sub);
    const ranked = sortRecommended(
      scoreCreatorsForBrand({
        profiles,
        brandCampaigns,
        interactions,
        interactedProfiles
      })
    );
    const paged = applyRecommendationCursor(ranked, cursor);
    const visible = paged.slice(0, limit);
    const hasMore = paged.length > limit;

    await this.recordRecommendationEvents(
      auth.sub,
      "creators",
      "profile",
      ranked,
      visible
    );

    return {
      profiles: visible,
      nextCursor: hasMore ? encodeRecommendationCursor(visible[visible.length - 1]) : null
    } satisfies CreatorProfileFeedPage;
  }

  async recordInteraction(
    auth: AccessTokenClaims,
    body: unknown
  ): Promise<{
    interactionCreated: boolean;
    matchCreated: boolean;
    matches: MatchRecord[];
  }> {
    const input = parseInteractionInput(body);

    await this.validateInteractionTarget(auth, input);
    const { created } = await this.store.upsertInteraction({
      id: randomUUID(),
      actorUserId: auth.sub,
      ...input
    });
    const matches =
      input.action === "like" ? await this.createMatchesForLike(auth, input) : [];
    await this.rewardsService?.awardSwipeAction({
      userId: auth.sub,
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.action
    });
    await Promise.all(
      matches
        .filter((match) => match.created)
        .map(({ match }) =>
          this.rewardsService?.awardMatchCreated({
            matchId: match.id,
            campaignId: match.campaignId,
            creatorUserId: match.creatorUserId,
            brandUserId: match.brandUserId
          })
        )
    );
    await Promise.all(
      matches
        .filter((match) => match.created)
        .map(async ({ match }) => {
          const campaign = await this.store.getCampaignById(match.campaignId);
          const title = campaign?.title ?? null;
          await this.notifier.notifyNewMatch({
            recipientUserId: match.creatorUserId,
            matchId: match.id,
            campaignTitle: title
          });
          await this.notifier.notifyNewMatch({
            recipientUserId: match.brandUserId,
            matchId: match.id,
            campaignTitle: title
          });
        })
    );

    return {
      interactionCreated: created,
      matchCreated: matches.some((match) => match.created),
      matches: matches.map((match) => match.match)
    };
  }

  async listFavorites(auth: AccessTokenClaims): Promise<FavoritesPage> {
    if (auth.role === "creator") {
      return {
        campaigns: await this.store.listSavedCampaigns(auth.sub),
        profiles: []
      };
    }
    if (auth.role === "brand") {
      return {
        campaigns: [],
        profiles: await this.store.listSavedProfiles(auth.sub)
      };
    }

    throw marketplaceErrors.forbidden();
  }

  async listMatches(auth: AccessTokenClaims): Promise<{ matches: MatchSummary[] }> {
    const matches = await this.store.listMatchesForUser(auth.sub);
    const summaries = await Promise.all(
      matches.map(async (match) => ({
        match,
        campaign: await this.store.getCampaignById(match.campaignId),
        creatorProfile: await this.store.getProfile(match.creatorUserId)
      }))
    );

    return { matches: summaries };
  }

  private async validateInteractionTarget(
    auth: AccessTokenClaims,
    input: {
      targetType: TargetType;
      targetId: string;
      action: InteractionAction;
    }
  ): Promise<void> {
    if (auth.role === "creator" && input.targetType === "campaign") {
      const campaign = await this.store.getCampaignById(input.targetId);

      if (!campaign || campaign.status !== "active") {
        throw marketplaceErrors.notFound();
      }

      return;
    }

    if (auth.role === "brand" && input.targetType === "profile") {
      const profile = await this.store.getProfile(input.targetId);

      if (!profile || profile.role !== "creator") {
        throw marketplaceErrors.notFound();
      }

      return;
    }

    throw marketplaceErrors.wrongRole();
  }

  private async createMatchesForLike(
    auth: AccessTokenClaims,
    input: {
      targetType: TargetType;
      targetId: string;
      action: InteractionAction;
    }
  ): Promise<Array<{ match: MatchRecord; created: boolean }>> {
    if (auth.role === "creator" && input.targetType === "campaign") {
      const campaign = await this.store.getCampaignById(input.targetId);

      if (!campaign) {
        return [];
      }

      const brandLikedCreator = await this.store.findInteraction({
        actorUserId: campaign.ownerUserId,
        targetType: "profile",
        targetId: auth.sub,
        action: "like"
      });

      if (!brandLikedCreator) {
        return [];
      }

      return [
        await this.store.createMatch({
          id: randomUUID(),
          creatorUserId: auth.sub,
          brandUserId: campaign.ownerUserId,
          campaignId: campaign.id
        })
      ];
    }

    if (auth.role === "brand" && input.targetType === "profile") {
      const likedCampaigns = await this.store.listLikedActiveCampaignsForBrandAndCreator({
        brandUserId: auth.sub,
        creatorUserId: input.targetId
      });

      return Promise.all(
        likedCampaigns.map((campaign) =>
          this.store.createMatch({
            id: randomUUID(),
            creatorUserId: input.targetId,
            brandUserId: auth.sub,
            campaignId: campaign.id
          })
        )
      );
    }

    return [];
  }

  private async getInteractedCampaigns(
    interactions: Array<{ targetType: TargetType; targetId: string }>
  ): Promise<CampaignRecord[]> {
    const ids = [
      ...new Set(
        interactions
          .filter((interaction) => interaction.targetType === "campaign")
          .map((interaction) => interaction.targetId)
      )
    ];
    const campaigns = await Promise.all(ids.map((id) => this.store.getCampaignById(id)));

    return campaigns.filter((campaign): campaign is CampaignRecord => campaign !== null);
  }

  private async getInteractedProfiles(
    interactions: Array<{ targetType: TargetType; targetId: string }>
  ): Promise<ProfileRecord[]> {
    const ids = [
      ...new Set(
        interactions
          .filter((interaction) => interaction.targetType === "profile")
          .map((interaction) => interaction.targetId)
      )
    ];
    const profiles = await Promise.all(ids.map((id) => this.store.getProfile(id)));

    return profiles.filter((profile): profile is ProfileRecord => profile !== null);
  }

  private async getMatchedCampaigns(userId: string): Promise<CampaignRecord[]> {
    const matches = await this.store.listMatchesForUser(userId);
    const campaigns = await Promise.all(
      matches.map((match) => this.store.getCampaignById(match.campaignId))
    );

    return campaigns.filter((campaign): campaign is CampaignRecord => campaign !== null);
  }

  private async recordRecommendationEvents<T extends CampaignRecord | ProfileRecord>(
    actorUserId: string,
    feedType: "campaigns" | "creators",
    targetType: TargetType,
    ranked: Array<Scored<T>>,
    visible: Array<Scored<T>>
  ): Promise<void> {
    const ranks = new Map(
      ranked.map((item, index) => [recommendationItemId(item), index + 1])
    );

    await this.store.createRecommendationEvents(
      visible.map((item) => ({
        id: randomUUID(),
        actorUserId,
        feedType,
        targetType,
        targetId: recommendationItemId(item),
        score: item.recommendationScore,
        rank: ranks.get(recommendationItemId(item)) ?? 1,
        reasons: item.recommendationReasons
      }))
    );
  }

  private applyModeration<
    T extends UpdateCampaignInput & {
      title: string;
      description: string;
      categories: string[];
      status: CampaignStatus;
      moderationReason: string | null;
    }
  >(input: T): T {
    const keyword = findBannedKeyword(input, this.config.bannedKeywords);

    if (!keyword) {
      return input;
    }

    return {
      ...input,
      status: "rejected",
      moderationReason: `Rejected by keyword filter: ${keyword}`
    };
  }
}

export const marketplaceErrors = {
  forbidden: () => new AuthError("FORBIDDEN", "This action is not allowed.", 403),
  invalidCursor: () =>
    new AuthError("INVALID_CURSOR", "Pagination cursor is invalid.", 400),
  invalidPayload: () => authErrors.invalidPayload(),
  notFound: () => new AuthError("NOT_FOUND", "Resource was not found.", 404),
  wrongRole: () =>
    new AuthError("WRONG_ROLE", "This role cannot perform this action.", 403)
};

function parseProfileInput(body: unknown): {
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  socialLinks: SocialLinks;
  niches: string[];
  languages: ContentLanguage[];
  regions: string[];
  platforms: SocialPlatform[];
  audienceSize: number | null;
  audienceAgeMin: number | null;
  audienceAgeMax: number | null;
} {
  if (!isRecord(body)) {
    throw marketplaceErrors.invalidPayload();
  }

  const displayName = parseRequiredString(body.displayName, 120);
  const avatarUrl = parseOptionalUrl(body.avatarUrl);
  const bio = parseOptionalString(body.bio, 500);
  const socialLinks = parseSocialLinks(body.socialLinks);
  const niches = parseStringList(body.niches, { maxItems: 12, maxLength: 40 });
  const languages = parseLanguageList(body.languages);
  const regions = parseStringList(body.regions, { maxItems: 12, maxLength: 40 });
  const platforms = parsePlatformList(body.platforms);
  const audienceSize = parseNullableInteger(body.audienceSize, {
    min: 0,
    max: 100000000
  });
  const audienceAgeMin = parseNullableInteger(body.audienceAgeMin, {
    min: 1,
    max: 120
  });
  const audienceAgeMax = parseNullableInteger(body.audienceAgeMax, {
    min: 1,
    max: 120
  });
  validateRange(audienceAgeMin, audienceAgeMax);

  return {
    displayName,
    avatarUrl,
    bio,
    socialLinks,
    niches,
    languages,
    regions,
    platforms,
    audienceSize,
    audienceAgeMin,
    audienceAgeMax
  };
}

function parseCampaignInput(
  body: unknown,
  current: CampaignRecord | null
): UpdateCampaignInput & {
  title: string;
  description: string;
  categories: string[];
  budgetCents: number;
  deadline: Date;
  mediaUrl: string;
  mediaType: MediaType;
  status: CampaignStatus;
  moderationReason: string | null;
  language: ContentLanguage;
  contentFormat: ContentFormat;
  targetRegions: string[];
  targetPlatforms: SocialPlatform[];
  targetInterests: string[];
  targetAudienceAgeMin: number | null;
  targetAudienceAgeMax: number | null;
  minAudienceSize: number | null;
  maxAudienceSize: number | null;
} {
  if (!isRecord(body)) {
    throw marketplaceErrors.invalidPayload();
  }

  const nextStatus = parseStatus(body.status ?? current?.status ?? "draft");
  const mediaUrl = parseRequiredUrl(body.mediaUrl ?? current?.mediaUrl);
  const mediaType = inferMediaType(mediaUrl);
  const deadline = parseDeadline(body.deadline ?? current?.deadline, nextStatus);
  const targetAudienceAgeMin = parseNullableInteger(
    body.targetAudienceAgeMin ?? current?.targetAudienceAgeMin,
    { min: 1, max: 120 }
  );
  const targetAudienceAgeMax = parseNullableInteger(
    body.targetAudienceAgeMax ?? current?.targetAudienceAgeMax,
    { min: 1, max: 120 }
  );
  const minAudienceSize = parseNullableInteger(
    body.minAudienceSize ?? current?.minAudienceSize,
    { min: 0, max: 100000000 }
  );
  const maxAudienceSize = parseNullableInteger(
    body.maxAudienceSize ?? current?.maxAudienceSize,
    { min: 0, max: 100000000 }
  );
  validateRange(targetAudienceAgeMin, targetAudienceAgeMax);
  validateRange(minAudienceSize, maxAudienceSize);

  return {
    title: parseRequiredString(body.title ?? current?.title, 140),
    description: parseRequiredString(body.description ?? current?.description, 2000),
    categories: parseCategories(body.categories ?? current?.categories),
    budgetCents: parseBudgetCents(
      body.budget ?? body.budgetCents ?? current?.budgetCents
    ),
    deadline,
    mediaUrl,
    mediaType,
    status: nextStatus,
    moderationReason: current?.moderationReason ?? null,
    language: parseLanguage(body.language ?? current?.language ?? "both"),
    contentFormat: parseContentFormat(
      body.contentFormat ?? body.format ?? current?.contentFormat ?? "short_video"
    ),
    targetRegions: parseStringList(body.targetRegions ?? current?.targetRegions, {
      maxItems: 12,
      maxLength: 40
    }),
    targetPlatforms: parsePlatformList(body.targetPlatforms ?? current?.targetPlatforms),
    targetInterests: parseStringList(body.targetInterests ?? current?.targetInterests, {
      maxItems: 12,
      maxLength: 40
    }),
    targetAudienceAgeMin,
    targetAudienceAgeMax,
    minAudienceSize,
    maxAudienceSize
  };
}

function parseSocialLinks(value: unknown): SocialLinks {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isRecord(value)) {
    throw marketplaceErrors.invalidPayload();
  }

  const links: SocialLinks = {};

  for (const platform of socialPlatforms) {
    const raw = value[platform];

    if (raw === undefined || raw === null || raw === "") {
      continue;
    }
    if (typeof raw !== "string") {
      throw marketplaceErrors.invalidPayload();
    }

    links[platform] = parseRequiredUrl(raw);
  }

  return links;
}

function parseRequiredString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    throw marketplaceErrors.invalidPayload();
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed.length > maxLength) {
    throw marketplaceErrors.invalidPayload();
  }

  return trimmed;
}

function parseOptionalString(value: unknown, maxLength: number): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string" || value.length > maxLength) {
    throw marketplaceErrors.invalidPayload();
  }

  return value.trim();
}

function parseOptionalUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return parseRequiredUrl(value);
}

function parseRequiredUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw marketplaceErrors.invalidPayload();
  }

  try {
    const url = new URL(value.trim());

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw marketplaceErrors.invalidPayload();
    }

    return url.toString();
  } catch {
    throw marketplaceErrors.invalidPayload();
  }
}

function parseCategories(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw marketplaceErrors.invalidPayload();
  }

  const categories = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    )
  ].sort();

  if (categories.length === 0 || categories.length > 10) {
    throw marketplaceErrors.invalidPayload();
  }

  return categories;
}

function parseStringList(
  value: unknown,
  options: { maxItems: number; maxLength: number }
): string[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  const rawItems =
    typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : null;

  if (!rawItems) {
    throw marketplaceErrors.invalidPayload();
  }

  const items = [
    ...new Set(
      rawItems
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    )
  ].sort();

  if (
    items.length > options.maxItems ||
    items.some((item) => item.length > options.maxLength)
  ) {
    throw marketplaceErrors.invalidPayload();
  }

  return items;
}

function parseLanguage(value: unknown): ContentLanguage {
  if (allowedLanguages.includes(value as ContentLanguage)) {
    return value as ContentLanguage;
  }

  throw marketplaceErrors.invalidPayload();
}

function parseOptionalLanguage(value: unknown): ContentLanguage | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return parseLanguage(value);
}

function parseLanguageList(value: unknown): ContentLanguage[] {
  const languages = parseStringList(value, { maxItems: 3, maxLength: 10 });

  if (
    !languages.every((language) => allowedLanguages.includes(language as ContentLanguage))
  ) {
    throw marketplaceErrors.invalidPayload();
  }

  return languages as ContentLanguage[];
}

function parseContentFormat(value: unknown): ContentFormat {
  if (allowedFormats.includes(value as ContentFormat)) {
    return value as ContentFormat;
  }

  throw marketplaceErrors.invalidPayload();
}

function parseOptionalContentFormat(value: unknown): ContentFormat | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return parseContentFormat(value);
}

function parsePlatform(value: unknown): SocialPlatform {
  if (socialPlatforms.includes(value as SocialPlatform)) {
    return value as SocialPlatform;
  }

  throw marketplaceErrors.invalidPayload();
}

function parseOptionalPlatform(value: unknown): SocialPlatform | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return parsePlatform(value);
}

function parsePlatformList(value: unknown): SocialPlatform[] {
  const platforms = parseStringList(value, { maxItems: 6, maxLength: 20 });

  if (
    !platforms.every((platform) => socialPlatforms.includes(platform as SocialPlatform))
  ) {
    throw marketplaceErrors.invalidPayload();
  }

  return platforms as SocialPlatform[];
}

function parseNullableInteger(
  value: unknown,
  options: { min: number; max: number }
): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(number) || number < options.min || number > options.max) {
    throw marketplaceErrors.invalidPayload();
  }

  return number;
}

function validateRange(min: number | null, max: number | null): void {
  if (min !== null && max !== null && min > max) {
    throw marketplaceErrors.invalidPayload();
  }
}

function parseCampaignFeedFilters(query: {
  [key: string]: unknown;
}): CampaignFeedFilters {
  const budgetMinCents =
    query.budgetMin === undefined || query.budgetMin === ""
      ? null
      : parseBudgetCents(query.budgetMin);
  const budgetMaxCents =
    query.budgetMax === undefined || query.budgetMax === ""
      ? null
      : parseBudgetCents(query.budgetMax);
  validateRange(budgetMinCents, budgetMaxCents);

  return {
    category: parseOptionalFilterString(query.category),
    budgetMinCents,
    budgetMaxCents,
    language: parseOptionalLanguage(query.language),
    format: parseOptionalContentFormat(query.format),
    region: parseOptionalFilterString(query.region),
    platform: parseOptionalPlatform(query.platform)
  };
}

function parseCreatorFeedFilters(query: { [key: string]: unknown }): CreatorFeedFilters {
  const audienceMin = parseNullableInteger(query.audienceMin, {
    min: 0,
    max: 100000000
  });
  const audienceMax = parseNullableInteger(query.audienceMax, {
    min: 0,
    max: 100000000
  });
  validateRange(audienceMin, audienceMax);

  return {
    niche: parseOptionalFilterString(query.niche),
    language: parseOptionalLanguage(query.language),
    region: parseOptionalFilterString(query.region),
    platform: parseOptionalPlatform(query.platform),
    audienceMin,
    audienceMax
  };
}

function parseOptionalFilterString(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw marketplaceErrors.invalidPayload();
  }

  const trimmed = value.trim().toLowerCase();

  if (!trimmed || trimmed.length > 40) {
    throw marketplaceErrors.invalidPayload();
  }

  return trimmed;
}

function parseBudgetCents(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  const cents =
    Number.isInteger(numeric) && numeric > 1000 ? numeric : Math.round(numeric * 100);

  if (!Number.isFinite(cents) || cents <= 0) {
    throw marketplaceErrors.invalidPayload();
  }

  return cents;
}

function parseDeadline(value: unknown, status: CampaignStatus): Date {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));

  if (Number.isNaN(date.getTime())) {
    throw marketplaceErrors.invalidPayload();
  }
  if (status === "active" && date.getTime() <= Date.now()) {
    throw marketplaceErrors.invalidPayload();
  }

  return date;
}

function parseStatus(value: unknown): CampaignStatus {
  if (allowedStatuses.includes(value as CampaignStatus)) {
    return value as CampaignStatus;
  }

  throw marketplaceErrors.invalidPayload();
}

function findBannedKeyword(
  input: { title: string; description: string; categories: string[] },
  keywords: string[]
): string | null {
  const haystack =
    `${input.title} ${input.description} ${input.categories.join(" ")}`.toLowerCase();

  return (
    keywords.find((keyword) => {
      const normalized = keyword.trim().toLowerCase();
      return normalized.length > 0 && haystack.includes(normalized);
    }) ?? null
  );
}

function isProfileComplete(profile: ProfileRecord): boolean {
  return (
    profile.displayName.trim().length > 0 &&
    (profile.bio.trim().length > 0 ||
      profile.niches.length > 0 ||
      Object.keys(profile.socialLinks).length > 0)
  );
}

function parseInteractionInput(body: unknown): {
  targetType: TargetType;
  targetId: string;
  action: InteractionAction;
} {
  if (!isRecord(body)) {
    throw marketplaceErrors.invalidPayload();
  }

  if (body.targetType !== "campaign" && body.targetType !== "profile") {
    throw marketplaceErrors.invalidPayload();
  }
  if (body.action !== "like" && body.action !== "dislike" && body.action !== "save") {
    throw marketplaceErrors.invalidPayload();
  }
  if (typeof body.targetId !== "string" || body.targetId.trim().length === 0) {
    throw marketplaceErrors.invalidPayload();
  }

  return {
    targetType: body.targetType,
    targetId: body.targetId.trim(),
    action: body.action
  };
}

function inferMediaType(mediaUrl: string): MediaType {
  const pathname = new URL(mediaUrl).pathname.toLowerCase();

  if (/\.(mp4|webm|mov|m4v)$/.test(pathname)) {
    return "video";
  }
  if (/\.(jpg|jpeg|png|gif|webp)$/.test(pathname)) {
    return "image";
  }

  throw marketplaceErrors.invalidPayload();
}

function parseLimit(value: unknown): number {
  const limit = Number(value ?? 10);

  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw marketplaceErrors.invalidPayload();
  }

  return limit;
}

function parseRecommendationFeedCursor(value: unknown) {
  try {
    return parseRecommendationCursor(value);
  } catch {
    throw marketplaceErrors.invalidCursor();
  }
}

function recommendationItemId(item: CampaignRecord | ProfileRecord): string {
  return "id" in item ? item.id : item.userId;
}

function requireRole(auth: AccessTokenClaims, role: UserRole): void {
  if (auth.role !== role) {
    throw marketplaceErrors.wrongRole();
  }
}

function toUserRole(value: string): UserRole {
  if (value === "creator" || value === "brand") {
    return value;
  }

  throw marketplaceErrors.forbidden();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
