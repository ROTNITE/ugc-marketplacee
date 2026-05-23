import pg from "pg";
import type {
  CampaignFeedFilters,
  CreateCampaignInput,
  CreatorFeedFilters,
  MarketplaceStore,
  UpdateCampaignInput,
  UpsertProfileInput
} from "./store.js";
import type {
  CampaignCursor,
  CampaignRecord,
  CampaignStatus,
  ContentFormat,
  ContentLanguage,
  InteractionAction,
  MatchRecord,
  MatchStatus,
  MediaType,
  ProfileRecord,
  RecommendationFeedType,
  SocialLinks,
  SocialPlatform,
  SwipeInteractionRecord,
  TargetType
} from "./types.js";
import type { UserRole } from "../auth/types.js";

type ProfileRow = {
  user_id: string;
  role: UserRole;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  social_links: SocialLinks;
  niches: string[];
  languages: ContentLanguage[];
  regions: string[];
  platforms: SocialPlatform[];
  audience_size: number | null;
  audience_age_min: number | null;
  audience_age_max: number | null;
  updated_at: Date;
};

type CampaignRow = {
  id: string;
  owner_user_id: string;
  title: string;
  description: string;
  categories: string[];
  budget_cents: number;
  deadline: Date;
  media_url: string;
  media_type: MediaType;
  status: CampaignStatus;
  moderation_reason: string | null;
  language: ContentLanguage;
  content_format: ContentFormat;
  target_regions: string[];
  target_platforms: SocialPlatform[];
  target_interests: string[];
  target_audience_age_min: number | null;
  target_audience_age_max: number | null;
  min_audience_size: number | null;
  max_audience_size: number | null;
  created_at: Date;
  updated_at: Date;
};

type InteractionRow = {
  id: string;
  actor_user_id: string;
  target_type: TargetType;
  target_id: string;
  action: InteractionAction;
  created_at: Date;
};

type MatchRow = {
  id: string;
  creator_user_id: string;
  brand_user_id: string;
  campaign_id: string;
  status: MatchStatus;
  created_at: Date;
};

export class PgMarketplaceStore implements MarketplaceStore {
  constructor(private readonly pool: pg.Pool) {}

  async getProfile(userId: string): Promise<ProfileRecord | null> {
    const result = await this.pool.query<ProfileRow>(
      "SELECT * FROM profiles WHERE user_id = $1",
      [userId]
    );

    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async upsertProfile(input: UpsertProfileInput): Promise<ProfileRecord> {
    const result = await this.pool.query<ProfileRow>(
      `
        INSERT INTO profiles (
          user_id, role, display_name, avatar_url, bio, social_links,
          niches, languages, regions, platforms, audience_size,
          audience_age_min, audience_age_max
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (user_id)
        DO UPDATE SET
          role = EXCLUDED.role,
          display_name = EXCLUDED.display_name,
          avatar_url = EXCLUDED.avatar_url,
          bio = EXCLUDED.bio,
          social_links = EXCLUDED.social_links,
          niches = EXCLUDED.niches,
          languages = EXCLUDED.languages,
          regions = EXCLUDED.regions,
          platforms = EXCLUDED.platforms,
          audience_size = EXCLUDED.audience_size,
          audience_age_min = EXCLUDED.audience_age_min,
          audience_age_max = EXCLUDED.audience_age_max,
          updated_at = now()
        RETURNING *
      `,
      [
        input.userId,
        input.role,
        input.displayName,
        input.avatarUrl,
        input.bio,
        JSON.stringify(input.socialLinks),
        input.niches,
        input.languages,
        input.regions,
        input.platforms,
        input.audienceSize,
        input.audienceAgeMin,
        input.audienceAgeMax
      ]
    );

    return mapProfile(result.rows[0]);
  }

  async createCampaign(input: CreateCampaignInput): Promise<CampaignRecord> {
    const result = await this.pool.query<CampaignRow>(
      `
        INSERT INTO campaigns (
          id, owner_user_id, title, description, categories, budget_cents,
          deadline, media_url, media_type, status, language, content_format,
          moderation_reason,
          target_regions, target_platforms, target_interests,
          target_audience_age_min, target_audience_age_max,
          min_audience_size, max_audience_size
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        )
        RETURNING *
      `,
      [
        input.id,
        input.ownerUserId,
        input.title,
        input.description,
        input.categories,
        input.budgetCents,
        input.deadline,
        input.mediaUrl,
        input.mediaType,
        input.status,
        input.language,
        input.contentFormat,
        input.moderationReason ?? null,
        input.targetRegions,
        input.targetPlatforms,
        input.targetInterests,
        input.targetAudienceAgeMin,
        input.targetAudienceAgeMax,
        input.minAudienceSize,
        input.maxAudienceSize
      ]
    );

    return mapCampaign(result.rows[0]);
  }

  async getCampaignById(id: string): Promise<CampaignRecord | null> {
    const result = await this.pool.query<CampaignRow>(
      "SELECT * FROM campaigns WHERE id = $1",
      [id]
    );

    return result.rows[0] ? mapCampaign(result.rows[0]) : null;
  }

  async listOwnCampaigns(ownerUserId: string): Promise<CampaignRecord[]> {
    const result = await this.pool.query<CampaignRow>(
      `
        SELECT * FROM campaigns
        WHERE owner_user_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [ownerUserId]
    );

    return result.rows.map(mapCampaign);
  }

  async listCampaignsForAdmin(input: {
    query: string | null;
    status: CampaignStatus | null;
    limit: number;
    offset: number;
  }): Promise<CampaignRecord[]> {
    const result = await this.pool.query<CampaignRow>(
      `
        SELECT * FROM campaigns
        WHERE ($1::text IS NULL OR title ILIKE '%' || $1 || '%'
          OR description ILIKE '%' || $1 || '%'
          OR EXISTS (SELECT 1 FROM unnest(categories) AS category WHERE category ILIKE '%' || $1 || '%'))
          AND ($2::text IS NULL OR status = $2)
        ORDER BY created_at DESC, id DESC
        LIMIT $3 OFFSET $4
      `,
      [input.query, input.status, input.limit, input.offset]
    );

    return result.rows.map(mapCampaign);
  }

  async updateCampaign(id: string, input: UpdateCampaignInput): Promise<CampaignRecord> {
    const result = await this.pool.query<CampaignRow>(
      `
        UPDATE campaigns
        SET
          title = COALESCE($2, title),
          description = COALESCE($3, description),
          categories = COALESCE($4, categories),
          budget_cents = COALESCE($5, budget_cents),
          deadline = COALESCE($6, deadline),
          media_url = COALESCE($7, media_url),
          media_type = COALESCE($8, media_type),
          status = COALESCE($9, status),
          language = COALESCE($10, language),
          content_format = COALESCE($11, content_format),
          moderation_reason = COALESCE($19, moderation_reason),
          target_regions = COALESCE($12, target_regions),
          target_platforms = COALESCE($13, target_platforms),
          target_interests = COALESCE($14, target_interests),
          target_audience_age_min = COALESCE($15, target_audience_age_min),
          target_audience_age_max = COALESCE($16, target_audience_age_max),
          min_audience_size = COALESCE($17, min_audience_size),
          max_audience_size = COALESCE($18, max_audience_size),
          updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        id,
        input.title,
        input.description,
        input.categories,
        input.budgetCents,
        input.deadline,
        input.mediaUrl,
        input.mediaType,
        input.status,
        input.language,
        input.contentFormat,
        input.targetRegions,
        input.targetPlatforms,
        input.targetInterests,
        input.targetAudienceAgeMin,
        input.targetAudienceAgeMax,
        input.minAudienceSize,
        input.maxAudienceSize,
        input.moderationReason
      ]
    );

    return mapCampaign(result.rows[0]);
  }

  async listActiveCampaigns(input: {
    cursor: CampaignCursor | null;
    filters: CampaignFeedFilters;
    limit: number;
    excludeActorUserId?: string;
  }): Promise<CampaignRecord[]> {
    const result = await this.pool.query<CampaignRow>(
      `
        SELECT * FROM campaigns
        WHERE status = 'active'
          AND (
            $1::timestamptz IS NULL
            OR created_at < $1::timestamptz
            OR (created_at = $1::timestamptz AND id < $2)
          )
          AND (
            $4::uuid IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM swipe_interactions
              WHERE actor_user_id = $4
                AND target_type = 'campaign'
                AND target_id = campaigns.id
                AND action IN ('like', 'dislike')
            )
          )
          AND ($5::text IS NULL OR $5 = ANY(categories))
          AND ($6::integer IS NULL OR budget_cents >= $6)
          AND ($7::integer IS NULL OR budget_cents <= $7)
          AND (
            $8::text IS NULL
            OR language = $8
            OR language = 'both'
          )
          AND ($9::text IS NULL OR content_format = $9)
          AND ($10::text IS NULL OR $10 = ANY(target_regions))
          AND ($11::text IS NULL OR $11 = ANY(target_platforms))
        ORDER BY created_at DESC, id DESC
        LIMIT $3
      `,
      [
        input.cursor?.createdAt ?? null,
        input.cursor?.id ?? null,
        input.limit,
        input.excludeActorUserId ?? null,
        input.filters.category,
        input.filters.budgetMinCents,
        input.filters.budgetMaxCents,
        input.filters.language,
        input.filters.format,
        input.filters.region,
        input.filters.platform
      ]
    );

    return result.rows.map(mapCampaign);
  }

  async listActiveCampaignCandidates(input: {
    filters: CampaignFeedFilters;
    limit: number;
    excludeActorUserId?: string;
  }): Promise<CampaignRecord[]> {
    const result = await this.pool.query<CampaignRow>(
      `
        SELECT * FROM campaigns
        WHERE status = 'active'
          AND (
            $2::uuid IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM swipe_interactions
              WHERE actor_user_id = $2
                AND target_type = 'campaign'
                AND target_id = campaigns.id
                AND action IN ('like', 'dislike')
            )
          )
          AND ($3::text IS NULL OR $3 = ANY(categories))
          AND ($4::integer IS NULL OR budget_cents >= $4)
          AND ($5::integer IS NULL OR budget_cents <= $5)
          AND (
            $6::text IS NULL
            OR language = $6
            OR language = 'both'
          )
          AND ($7::text IS NULL OR content_format = $7)
          AND ($8::text IS NULL OR $8 = ANY(target_regions))
          AND ($9::text IS NULL OR $9 = ANY(target_platforms))
        ORDER BY created_at DESC, id DESC
        LIMIT $1
      `,
      [
        input.limit,
        input.excludeActorUserId ?? null,
        input.filters.category,
        input.filters.budgetMinCents,
        input.filters.budgetMaxCents,
        input.filters.language,
        input.filters.format,
        input.filters.region,
        input.filters.platform
      ]
    );

    return result.rows.map(mapCampaign);
  }

  async listCreatorProfiles(input: {
    cursor: CampaignCursor | null;
    filters: CreatorFeedFilters;
    limit: number;
    excludeActorUserId: string;
  }): Promise<ProfileRecord[]> {
    const result = await this.pool.query<ProfileRow>(
      `
        SELECT * FROM profiles
        WHERE role = 'creator'
          AND user_id <> $3
          AND (
            $1::timestamptz IS NULL
            OR updated_at < $1::timestamptz
            OR (updated_at = $1::timestamptz AND user_id < $2)
          )
          AND NOT EXISTS (
            SELECT 1 FROM swipe_interactions
            WHERE actor_user_id = $3
              AND target_type = 'profile'
              AND target_id = profiles.user_id
              AND action IN ('like', 'dislike')
          )
          AND ($5::text IS NULL OR $5 = ANY(niches))
          AND ($6::text IS NULL OR $6 = ANY(languages))
          AND ($7::text IS NULL OR $7 = ANY(regions))
          AND ($8::text IS NULL OR $8 = ANY(platforms))
          AND ($9::integer IS NULL OR audience_size >= $9)
          AND ($10::integer IS NULL OR audience_size <= $10)
        ORDER BY updated_at DESC, user_id DESC
        LIMIT $4
      `,
      [
        input.cursor?.createdAt ?? null,
        input.cursor?.id ?? null,
        input.excludeActorUserId,
        input.limit,
        input.filters.niche,
        input.filters.language,
        input.filters.region,
        input.filters.platform,
        input.filters.audienceMin,
        input.filters.audienceMax
      ]
    );

    return result.rows.map(mapProfile);
  }

  async listCreatorProfileCandidates(input: {
    filters: CreatorFeedFilters;
    limit: number;
    excludeActorUserId: string;
  }): Promise<ProfileRecord[]> {
    const result = await this.pool.query<ProfileRow>(
      `
        SELECT * FROM profiles
        WHERE role = 'creator'
          AND user_id <> $2
          AND NOT EXISTS (
            SELECT 1 FROM swipe_interactions
            WHERE actor_user_id = $2
              AND target_type = 'profile'
              AND target_id = profiles.user_id
              AND action IN ('like', 'dislike')
          )
          AND ($3::text IS NULL OR $3 = ANY(niches))
          AND ($4::text IS NULL OR $4 = ANY(languages))
          AND ($5::text IS NULL OR $5 = ANY(regions))
          AND ($6::text IS NULL OR $6 = ANY(platforms))
          AND ($7::integer IS NULL OR audience_size >= $7)
          AND ($8::integer IS NULL OR audience_size <= $8)
        ORDER BY updated_at DESC, user_id DESC
        LIMIT $1
      `,
      [
        input.limit,
        input.excludeActorUserId,
        input.filters.niche,
        input.filters.language,
        input.filters.region,
        input.filters.platform,
        input.filters.audienceMin,
        input.filters.audienceMax
      ]
    );

    return result.rows.map(mapProfile);
  }

  async upsertInteraction(input: {
    id: string;
    actorUserId: string;
    targetType: TargetType;
    targetId: string;
    action: InteractionAction;
  }): Promise<{ interaction: SwipeInteractionRecord; created: boolean }> {
    const existing = await this.findInteraction(input);

    if (existing) {
      return { interaction: existing, created: false };
    }

    const result = await this.pool.query<InteractionRow>(
      `
        INSERT INTO swipe_interactions (id, actor_user_id, target_type, target_id, action)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (actor_user_id, target_type, target_id, action)
        DO UPDATE SET actor_user_id = EXCLUDED.actor_user_id
        RETURNING *
      `,
      [input.id, input.actorUserId, input.targetType, input.targetId, input.action]
    );

    return {
      interaction: mapInteraction(result.rows[0]),
      created: result.rows[0]?.id === input.id
    };
  }

  async findInteraction(input: {
    actorUserId: string;
    targetType: TargetType;
    targetId: string;
    action: InteractionAction;
  }): Promise<SwipeInteractionRecord | null> {
    const result = await this.pool.query<InteractionRow>(
      `
        SELECT * FROM swipe_interactions
        WHERE actor_user_id = $1
          AND target_type = $2
          AND target_id = $3
          AND action = $4
      `,
      [input.actorUserId, input.targetType, input.targetId, input.action]
    );

    return result.rows[0] ? mapInteraction(result.rows[0]) : null;
  }

  async listInteractionsForActor(actorUserId: string): Promise<SwipeInteractionRecord[]> {
    const result = await this.pool.query<InteractionRow>(
      `
        SELECT * FROM swipe_interactions
        WHERE actor_user_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [actorUserId]
    );

    return result.rows.map(mapInteraction);
  }

  async listSavedCampaigns(actorUserId: string): Promise<CampaignRecord[]> {
    const result = await this.pool.query<CampaignRow>(
      `
        SELECT campaigns.* FROM campaigns
        INNER JOIN swipe_interactions
          ON swipe_interactions.target_type = 'campaign'
          AND swipe_interactions.target_id = campaigns.id
          AND swipe_interactions.action = 'save'
        WHERE swipe_interactions.actor_user_id = $1
        ORDER BY swipe_interactions.created_at DESC, campaigns.id DESC
      `,
      [actorUserId]
    );

    return result.rows.map(mapCampaign);
  }

  async listSavedProfiles(actorUserId: string): Promise<ProfileRecord[]> {
    const result = await this.pool.query<ProfileRow>(
      `
        SELECT profiles.* FROM profiles
        INNER JOIN swipe_interactions
          ON swipe_interactions.target_type = 'profile'
          AND swipe_interactions.target_id = profiles.user_id
          AND swipe_interactions.action = 'save'
        WHERE swipe_interactions.actor_user_id = $1
        ORDER BY swipe_interactions.created_at DESC, profiles.user_id DESC
      `,
      [actorUserId]
    );

    return result.rows.map(mapProfile);
  }

  async listLikedActiveCampaignsForBrandAndCreator(input: {
    brandUserId: string;
    creatorUserId: string;
  }): Promise<CampaignRecord[]> {
    const result = await this.pool.query<CampaignRow>(
      `
        SELECT campaigns.* FROM campaigns
        INNER JOIN swipe_interactions
          ON swipe_interactions.target_type = 'campaign'
          AND swipe_interactions.target_id = campaigns.id
          AND swipe_interactions.action = 'like'
        WHERE campaigns.owner_user_id = $1
          AND campaigns.status = 'active'
          AND swipe_interactions.actor_user_id = $2
        ORDER BY campaigns.created_at DESC, campaigns.id DESC
      `,
      [input.brandUserId, input.creatorUserId]
    );

    return result.rows.map(mapCampaign);
  }

  async createMatch(input: {
    id: string;
    creatorUserId: string;
    brandUserId: string;
    campaignId: string;
  }): Promise<{ match: MatchRecord; created: boolean }> {
    const result = await this.pool.query<MatchRow>(
      `
        INSERT INTO matches (id, creator_user_id, brand_user_id, campaign_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (creator_user_id, brand_user_id, campaign_id)
        DO UPDATE SET status = matches.status
        RETURNING *
      `,
      [input.id, input.creatorUserId, input.brandUserId, input.campaignId]
    );

    return {
      match: mapMatch(result.rows[0]),
      created: result.rows[0]?.id === input.id
    };
  }

  async listMatchesForUser(userId: string): Promise<MatchRecord[]> {
    const result = await this.pool.query<MatchRow>(
      `
        SELECT * FROM matches
        WHERE creator_user_id = $1 OR brand_user_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [userId]
    );

    return result.rows.map(mapMatch);
  }

  async createRecommendationEvents(
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
  ): Promise<void> {
    if (input.length === 0) {
      return;
    }

    const values: unknown[] = [];
    const placeholders = input.map((event, index) => {
      const base = index * 8;
      values.push(
        event.id,
        event.actorUserId,
        event.feedType,
        event.targetType,
        event.targetId,
        event.score,
        event.rank,
        event.reasons
      );

      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
    });

    await this.pool.query(
      `
        INSERT INTO recommendation_events (
          id, actor_user_id, feed_type, target_type, target_id, score, rank, reasons
        )
        VALUES ${placeholders.join(", ")}
      `,
      values
    );
  }
}

function mapProfile(row: ProfileRow | undefined): ProfileRecord {
  if (!row) {
    throw new Error("Expected profile row.");
  }

  return {
    userId: row.user_id,
    role: row.role,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    socialLinks: row.social_links,
    niches: row.niches,
    languages: row.languages,
    regions: row.regions,
    platforms: row.platforms,
    audienceSize: row.audience_size,
    audienceAgeMin: row.audience_age_min,
    audienceAgeMax: row.audience_age_max,
    updatedAt: row.updated_at
  };
}

function mapCampaign(row: CampaignRow | undefined): CampaignRecord {
  if (!row) {
    throw new Error("Expected campaign row.");
  }

  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    description: row.description,
    categories: row.categories,
    budgetCents: row.budget_cents,
    deadline: row.deadline,
    mediaUrl: row.media_url,
    mediaType: row.media_type,
    status: row.status,
    moderationReason: row.moderation_reason,
    language: row.language,
    contentFormat: row.content_format,
    targetRegions: row.target_regions,
    targetPlatforms: row.target_platforms,
    targetInterests: row.target_interests,
    targetAudienceAgeMin: row.target_audience_age_min,
    targetAudienceAgeMax: row.target_audience_age_max,
    minAudienceSize: row.min_audience_size,
    maxAudienceSize: row.max_audience_size,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapInteraction(row: InteractionRow | undefined): SwipeInteractionRecord {
  if (!row) {
    throw new Error("Expected interaction row.");
  }

  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    action: row.action,
    createdAt: row.created_at
  };
}

function mapMatch(row: MatchRow | undefined): MatchRecord {
  if (!row) {
    throw new Error("Expected match row.");
  }

  return {
    id: row.id,
    creatorUserId: row.creator_user_id,
    brandUserId: row.brand_user_id,
    campaignId: row.campaign_id,
    status: row.status,
    createdAt: row.created_at
  };
}
