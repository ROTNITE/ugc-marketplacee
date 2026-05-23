import type { UserRole } from "../auth/types.js";

export type SocialPlatform =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "vk"
  | "telegram"
  | "website";

export type SocialLinks = Partial<Record<SocialPlatform, string>>;
export type ContentLanguage = "ru" | "en" | "both";
export type ContentFormat = "short_video" | "long_video" | "review" | "demo";

export type ProfileRecord = {
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
  recommendationScore?: number;
  recommendationReasons?: string[];
  updatedAt: Date;
};

export type MediaType = "image" | "video";
export type CampaignStatus = "draft" | "active" | "paused" | "archived" | "rejected";

export type CampaignRecord = {
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
  recommendationScore?: number;
  recommendationReasons?: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type CampaignCursor = {
  createdAt: Date;
  id: string;
};

export type CampaignFeedPage = {
  campaigns: CampaignRecord[];
  nextCursor: string | null;
};

export type TargetType = "campaign" | "profile";
export type InteractionAction = "like" | "dislike" | "save";

export type SwipeInteractionRecord = {
  id: string;
  actorUserId: string;
  targetType: TargetType;
  targetId: string;
  action: InteractionAction;
  createdAt: Date;
};

export type RecommendationFeedType = "campaigns" | "creators";

export type RecommendationEventRecord = {
  id: string;
  actorUserId: string;
  feedType: RecommendationFeedType;
  targetType: TargetType;
  targetId: string;
  score: number;
  rank: number;
  reasons: string[];
  createdAt: Date;
};

export type MatchStatus = "active" | "hidden" | "archived";

export type MatchRecord = {
  id: string;
  creatorUserId: string;
  brandUserId: string;
  campaignId: string;
  status: MatchStatus;
  createdAt: Date;
};

export type CreatorProfileFeedPage = {
  profiles: ProfileRecord[];
  nextCursor: string | null;
};

export type FavoritesPage = {
  campaigns: CampaignRecord[];
  profiles: ProfileRecord[];
};

export type MatchSummary = {
  match: MatchRecord;
  campaign: CampaignRecord | null;
  creatorProfile: ProfileRecord | null;
};
