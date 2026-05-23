import type { UserRole } from "../auth/types.js";
import type {
  CampaignCursor,
  CampaignRecord,
  CampaignStatus,
  ContentFormat,
  ContentLanguage,
  InteractionAction,
  MatchRecord,
  MediaType,
  ProfileRecord,
  RecommendationFeedType,
  SocialLinks,
  SocialPlatform,
  SwipeInteractionRecord,
  TargetType
} from "./types.js";

export type UpsertProfileInput = {
  userId: string;
  role: UserRole;
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
};

export type CreateCampaignInput = {
  id: string;
  ownerUserId: string;
  title: string;
  description: string;
  categories: string[];
  budgetCents: number;
  deadline: Date;
  mediaUrl: string;
  mediaType: MediaType;
  status: CampaignStatus;
  moderationReason?: string | null;
  language: ContentLanguage;
  contentFormat: ContentFormat;
  targetRegions: string[];
  targetPlatforms: SocialPlatform[];
  targetInterests: string[];
  targetAudienceAgeMin: number | null;
  targetAudienceAgeMax: number | null;
  minAudienceSize: number | null;
  maxAudienceSize: number | null;
};

export type UpdateCampaignInput = Partial<
  Pick<
    CreateCampaignInput,
    | "title"
    | "description"
    | "categories"
    | "budgetCents"
    | "deadline"
    | "mediaUrl"
    | "mediaType"
    | "status"
    | "moderationReason"
    | "language"
    | "contentFormat"
    | "targetRegions"
    | "targetPlatforms"
    | "targetInterests"
    | "targetAudienceAgeMin"
    | "targetAudienceAgeMax"
    | "minAudienceSize"
    | "maxAudienceSize"
  >
>;

export type CampaignFeedFilters = {
  category: string | null;
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  language: ContentLanguage | null;
  format: ContentFormat | null;
  region: string | null;
  platform: SocialPlatform | null;
};

export type CreatorFeedFilters = {
  niche: string | null;
  language: ContentLanguage | null;
  region: string | null;
  platform: SocialPlatform | null;
  audienceMin: number | null;
  audienceMax: number | null;
};

export type MarketplaceStore = {
  getProfile(userId: string): Promise<ProfileRecord | null>;
  upsertProfile(input: UpsertProfileInput): Promise<ProfileRecord>;
  createCampaign(input: CreateCampaignInput): Promise<CampaignRecord>;
  getCampaignById(id: string): Promise<CampaignRecord | null>;
  listOwnCampaigns(ownerUserId: string): Promise<CampaignRecord[]>;
  updateCampaign(id: string, input: UpdateCampaignInput): Promise<CampaignRecord>;
  listCampaignsForAdmin(input: {
    query: string | null;
    status: CampaignStatus | null;
    limit: number;
    offset: number;
  }): Promise<CampaignRecord[]>;
  listActiveCampaigns(input: {
    cursor: CampaignCursor | null;
    filters: CampaignFeedFilters;
    limit: number;
    excludeActorUserId?: string;
  }): Promise<CampaignRecord[]>;
  listActiveCampaignCandidates(input: {
    filters: CampaignFeedFilters;
    limit: number;
    excludeActorUserId?: string;
  }): Promise<CampaignRecord[]>;
  listCreatorProfiles(input: {
    cursor: CampaignCursor | null;
    filters: CreatorFeedFilters;
    limit: number;
    excludeActorUserId: string;
  }): Promise<ProfileRecord[]>;
  listCreatorProfileCandidates(input: {
    filters: CreatorFeedFilters;
    limit: number;
    excludeActorUserId: string;
  }): Promise<ProfileRecord[]>;
  upsertInteraction(input: {
    id: string;
    actorUserId: string;
    targetType: TargetType;
    targetId: string;
    action: InteractionAction;
  }): Promise<{ interaction: SwipeInteractionRecord; created: boolean }>;
  findInteraction(input: {
    actorUserId: string;
    targetType: TargetType;
    targetId: string;
    action: InteractionAction;
  }): Promise<SwipeInteractionRecord | null>;
  listInteractionsForActor(actorUserId: string): Promise<SwipeInteractionRecord[]>;
  listSavedCampaigns(actorUserId: string): Promise<CampaignRecord[]>;
  listSavedProfiles(actorUserId: string): Promise<ProfileRecord[]>;
  listLikedActiveCampaignsForBrandAndCreator(input: {
    brandUserId: string;
    creatorUserId: string;
  }): Promise<CampaignRecord[]>;
  createMatch(input: {
    id: string;
    creatorUserId: string;
    brandUserId: string;
    campaignId: string;
  }): Promise<{ match: MatchRecord; created: boolean }>;
  listMatchesForUser(userId: string): Promise<MatchRecord[]>;
  createRecommendationEvents(
    input: Array<{
      id: string;
      actorUserId: string;
      feedType: RecommendationFeedType;
      targetType: TargetType;
      targetId: string;
      score: number;
      rank: number;
      reasons: string[];
    }>
  ): Promise<void>;
};
