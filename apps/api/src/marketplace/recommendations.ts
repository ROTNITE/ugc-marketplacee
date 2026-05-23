import type {
  CampaignRecord,
  ContentLanguage,
  ProfileRecord,
  SwipeInteractionRecord
} from "./types.js";

export type Scored<T extends CampaignRecord | ProfileRecord> = T & {
  recommendationScore: number;
  recommendationReasons: string[];
};

export type RecommendationCursor =
  | {
      kind: "rank";
      score: number;
      createdAt: Date;
      id: string;
    }
  | {
      kind: "legacy";
      createdAt: Date;
      id: string;
    };

type CampaignHistory = {
  positiveTerms: Set<string>;
  negativeTerms: Set<string>;
  likedCampaignIds: Set<string>;
  dislikedCampaignIds: Set<string>;
};

type CreatorHistory = {
  positiveTerms: Set<string>;
  negativeTerms: Set<string>;
  likedProfileIds: Set<string>;
  dislikedProfileIds: Set<string>;
};

export function scoreCampaignsForCreator(input: {
  campaigns: CampaignRecord[];
  creatorProfile: ProfileRecord | null;
  interactions: SwipeInteractionRecord[];
  interactedCampaigns: CampaignRecord[];
  matchedCampaigns: CampaignRecord[];
}): Array<Scored<CampaignRecord>> {
  const history = buildCampaignHistory(
    input.interactions,
    input.interactedCampaigns,
    input.matchedCampaigns
  );

  return input.campaigns.map((campaign) =>
    scoreCampaignForCreator(campaign, input.creatorProfile, history)
  );
}

export function scoreCreatorsForBrand(input: {
  profiles: ProfileRecord[];
  brandCampaigns: CampaignRecord[];
  interactions: SwipeInteractionRecord[];
  interactedProfiles: ProfileRecord[];
}): Array<Scored<ProfileRecord>> {
  const history = buildCreatorHistory(input.interactions, [
    ...input.profiles,
    ...input.interactedProfiles
  ]);
  const activeCampaigns = input.brandCampaigns.filter(
    (campaign) => campaign.status === "active"
  );
  const campaigns = activeCampaigns.length > 0 ? activeCampaigns : input.brandCampaigns;

  return input.profiles.map((profile) => {
    const campaignScores = campaigns.map((campaign) =>
      scoreProfileForCampaign(profile, campaign)
    );
    const bestCampaignScore = campaignScores.sort(
      (left, right) => right.score - left.score
    )[0] ?? { score: 0, reasons: [] };
    const terms = profileTerms(profile);
    const positiveOverlap = overlapCount(terms, history.positiveTerms);
    const negativeOverlap = overlapCount(terms, history.negativeTerms);
    const directBoost = history.likedProfileIds.has(profile.userId) ? 25 : 0;
    const directPenalty = history.dislikedProfileIds.has(profile.userId) ? -25 : 0;
    const score =
      bestCampaignScore.score +
      positiveOverlap * 12 -
      negativeOverlap * 10 +
      directBoost +
      directPenalty;
    const reasons = [
      ...bestCampaignScore.reasons,
      ...reason("positive history", positiveOverlap),
      ...reason("negative history", negativeOverlap)
    ];

    if (directBoost) {
      reasons.push("previously liked");
    }
    if (directPenalty) {
      reasons.push("previously disliked");
    }

    return withScore(profile, score, reasons);
  });
}

export function sortRecommended<T extends CampaignRecord | ProfileRecord>(
  items: Array<Scored<T>>
): Array<Scored<T>> {
  return [...items].sort((left, right) => {
    const byScore = right.recommendationScore - left.recommendationScore;

    if (byScore !== 0) {
      return byScore;
    }

    const leftDate = itemDate(left);
    const rightDate = itemDate(right);
    const byDate = rightDate.getTime() - leftDate.getTime();

    if (byDate !== 0) {
      return byDate;
    }

    return itemId(right).localeCompare(itemId(left));
  });
}

export function applyRecommendationCursor<T extends CampaignRecord | ProfileRecord>(
  items: Array<Scored<T>>,
  cursor: RecommendationCursor | null
): Array<Scored<T>> {
  if (!cursor) {
    return items;
  }

  return items.filter((item) => {
    const createdAt = itemDate(item);
    const id = itemId(item);

    if (cursor.kind === "legacy") {
      return (
        createdAt.getTime() < cursor.createdAt.getTime() ||
        (createdAt.getTime() === cursor.createdAt.getTime() && id < cursor.id)
      );
    }

    return (
      item.recommendationScore < cursor.score ||
      (item.recommendationScore === cursor.score &&
        (createdAt.getTime() < cursor.createdAt.getTime() ||
          (createdAt.getTime() === cursor.createdAt.getTime() && id < cursor.id)))
    );
  });
}

export function encodeRecommendationCursor(
  item: Scored<CampaignRecord | ProfileRecord> | undefined
): string | null {
  if (!item) {
    return null;
  }

  return `rank_${Buffer.from(
    JSON.stringify({
      score: item.recommendationScore,
      createdAt: itemDate(item).toISOString(),
      id: itemId(item)
    })
  ).toString("base64url")}`;
}

export function parseRecommendationCursor(value: unknown): RecommendationCursor | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("INVALID_CURSOR");
  }

  if (value.startsWith("rank:")) {
    const [prefix, scoreRaw, ...rest] = value.split(":");
    const id = rest.pop();
    const dateRaw = rest.join(":");
    const score = Number(scoreRaw);
    const createdAt = new Date(dateRaw ?? "");

    if (
      prefix !== "rank" ||
      !Number.isFinite(score) ||
      Number.isNaN(createdAt.getTime()) ||
      !id
    ) {
      throw new Error("INVALID_CURSOR");
    }

    return { kind: "rank", score, createdAt, id };
  }
  if (value.startsWith("rank_")) {
    try {
      const payload = JSON.parse(
        Buffer.from(value.slice("rank_".length), "base64url").toString("utf8")
      ) as { score?: unknown; createdAt?: unknown; id?: unknown };
      const score = Number(payload.score);
      const createdAt = new Date(String(payload.createdAt ?? ""));

      if (
        !Number.isFinite(score) ||
        Number.isNaN(createdAt.getTime()) ||
        typeof payload.id !== "string" ||
        payload.id.length === 0
      ) {
        throw new Error("bad cursor");
      }

      return { kind: "rank", score, createdAt, id: payload.id };
    } catch {
      throw new Error("INVALID_CURSOR");
    }
  }

  const separator = value.lastIndexOf("_");

  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("INVALID_CURSOR");
  }

  const createdAt = new Date(value.slice(0, separator));
  const id = value.slice(separator + 1);

  if (Number.isNaN(createdAt.getTime()) || !id) {
    throw new Error("INVALID_CURSOR");
  }

  return { kind: "legacy", createdAt, id };
}

function scoreCampaignForCreator(
  campaign: CampaignRecord,
  profile: ProfileRecord | null,
  history: CampaignHistory
): Scored<CampaignRecord> {
  const creatorTerms = profile ? profileTerms(profile) : new Set<string>();
  const campaignTerms = campaignTopicTerms(campaign);
  const topicOverlap = overlapCount(creatorTerms, campaignTerms);
  const positiveOverlap = overlapCount(campaignTerms, history.positiveTerms);
  const negativeOverlap = overlapCount(campaignTerms, history.negativeTerms);
  const languageScore = languageCompatibility(
    profile?.languages ?? [],
    campaign.language
  );
  const regionOverlap = profile
    ? overlapCount(toSet(profile.regions), toSet(campaign.targetRegions))
    : 0;
  const platformOverlap = profile
    ? overlapCount(toSet(profile.platforms), toSet(campaign.targetPlatforms))
    : 0;
  const audienceScore = profile
    ? scoreAudienceFit(profile, campaign)
    : { score: 0, reasons: [] };
  const score =
    topicOverlap * 28 +
    positiveOverlap * 14 -
    negativeOverlap * 12 +
    languageScore.score +
    regionOverlap * 12 +
    platformOverlap * 12 +
    audienceScore.score;
  const reasons = [
    ...reason("topic overlap", topicOverlap),
    ...reason("positive history", positiveOverlap),
    ...reason("negative history", negativeOverlap),
    ...languageScore.reasons,
    ...reason("region overlap", regionOverlap),
    ...reason("platform overlap", platformOverlap),
    ...audienceScore.reasons
  ];

  if (history.likedCampaignIds.has(campaign.id)) {
    reasons.push("previously liked");
  }
  if (history.dislikedCampaignIds.has(campaign.id)) {
    reasons.push("previously disliked");
  }

  return withScore(campaign, score, reasons);
}

function scoreProfileForCampaign(
  profile: ProfileRecord,
  campaign: CampaignRecord
): { score: number; reasons: string[] } {
  const profileTermsSet = profileTerms(profile);
  const campaignTerms = campaignTopicTerms(campaign);
  const topicOverlap = overlapCount(profileTermsSet, campaignTerms);
  const languageScore = languageCompatibility(profile.languages, campaign.language);
  const regionOverlap = overlapCount(
    toSet(profile.regions),
    toSet(campaign.targetRegions)
  );
  const platformOverlap = overlapCount(
    toSet(profile.platforms),
    toSet(campaign.targetPlatforms)
  );
  const audienceScore = scoreAudienceFit(profile, campaign);

  return {
    score:
      topicOverlap * 28 +
      languageScore.score +
      regionOverlap * 12 +
      platformOverlap * 12 +
      audienceScore.score,
    reasons: [
      ...reason("campaign fit", topicOverlap),
      ...languageScore.reasons,
      ...reason("region fit", regionOverlap),
      ...reason("platform fit", platformOverlap),
      ...audienceScore.reasons
    ]
  };
}

function scoreAudienceFit(
  profile: ProfileRecord,
  campaign: CampaignRecord
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (profile.audienceSize !== null) {
    const aboveMin =
      campaign.minAudienceSize === null ||
      profile.audienceSize >= campaign.minAudienceSize;
    const belowMax =
      campaign.maxAudienceSize === null ||
      profile.audienceSize <= campaign.maxAudienceSize;

    if (campaign.minAudienceSize !== null || campaign.maxAudienceSize !== null) {
      if (aboveMin && belowMax) {
        score += 18;
        reasons.push("audience size fit");
      } else {
        score -= 10;
        reasons.push("audience size mismatch");
      }
    }
  }

  if (
    profile.audienceAgeMin !== null &&
    profile.audienceAgeMax !== null &&
    campaign.targetAudienceAgeMin !== null &&
    campaign.targetAudienceAgeMax !== null
  ) {
    const overlaps =
      profile.audienceAgeMin <= campaign.targetAudienceAgeMax &&
      profile.audienceAgeMax >= campaign.targetAudienceAgeMin;

    if (overlaps) {
      score += 12;
      reasons.push("audience age fit");
    } else {
      score -= 8;
      reasons.push("audience age mismatch");
    }
  }

  return { score, reasons };
}

function languageCompatibility(
  profileLanguages: string[],
  campaignLanguage: ContentLanguage
): { score: number; reasons: string[] } {
  if (campaignLanguage === "both") {
    return { score: 10, reasons: ["language broad"] };
  }
  if (profileLanguages.length === 0) {
    return { score: 0, reasons: [] };
  }
  if (profileLanguages.includes(campaignLanguage) || profileLanguages.includes("both")) {
    return { score: 18, reasons: ["language fit"] };
  }

  return { score: -8, reasons: ["language mismatch"] };
}

function buildCampaignHistory(
  interactions: SwipeInteractionRecord[],
  interactedCampaigns: CampaignRecord[],
  matchedCampaigns: CampaignRecord[]
): CampaignHistory {
  const campaigns = new Map(
    interactedCampaigns.map((campaign) => [campaign.id, campaign])
  );
  const positiveTerms = new Set<string>();
  const negativeTerms = new Set<string>();
  const likedCampaignIds = new Set<string>();
  const dislikedCampaignIds = new Set<string>();

  for (const campaign of matchedCampaigns) {
    addAll(positiveTerms, campaignTopicTerms(campaign));
  }
  for (const interaction of interactions) {
    if (interaction.targetType !== "campaign") {
      continue;
    }

    const campaign = campaigns.get(interaction.targetId);

    if (!campaign) {
      continue;
    }
    if (interaction.action === "like" || interaction.action === "save") {
      addAll(positiveTerms, campaignTopicTerms(campaign));
      if (interaction.action === "like") {
        likedCampaignIds.add(campaign.id);
      }
    }
    if (interaction.action === "dislike") {
      addAll(negativeTerms, campaignTopicTerms(campaign));
      dislikedCampaignIds.add(campaign.id);
    }
  }

  return { positiveTerms, negativeTerms, likedCampaignIds, dislikedCampaignIds };
}

function buildCreatorHistory(
  interactions: SwipeInteractionRecord[],
  profiles: ProfileRecord[]
): CreatorHistory {
  const profileMap = new Map(profiles.map((profile) => [profile.userId, profile]));
  const positiveTerms = new Set<string>();
  const negativeTerms = new Set<string>();
  const likedProfileIds = new Set<string>();
  const dislikedProfileIds = new Set<string>();

  for (const interaction of interactions) {
    if (interaction.targetType !== "profile") {
      continue;
    }

    const profile = profileMap.get(interaction.targetId);

    if (!profile) {
      continue;
    }
    if (interaction.action === "like" || interaction.action === "save") {
      addAll(positiveTerms, profileTerms(profile));
      if (interaction.action === "like") {
        likedProfileIds.add(profile.userId);
      }
    }
    if (interaction.action === "dislike") {
      addAll(negativeTerms, profileTerms(profile));
      dislikedProfileIds.add(profile.userId);
    }
  }

  return { positiveTerms, negativeTerms, likedProfileIds, dislikedProfileIds };
}

function withScore<T extends CampaignRecord | ProfileRecord>(
  item: T,
  score: number,
  reasons: string[]
): Scored<T> {
  const normalized = Math.round(score * 100) / 100;

  return {
    ...item,
    recommendationScore: normalized,
    recommendationReasons: [...new Set(reasons)]
  };
}

function campaignTopicTerms(campaign: CampaignRecord): Set<string> {
  return toSet([...campaign.categories, ...campaign.targetInterests]);
}

function profileTerms(profile: ProfileRecord): Set<string> {
  return toSet([...profile.niches, ...profile.platforms, ...profile.regions]);
}

function toSet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function overlapCount(left: Set<string>, right: Set<string>): number {
  let count = 0;

  for (const value of left) {
    if (right.has(value)) {
      count += 1;
    }
  }

  return count;
}

function addAll(target: Set<string>, values: Set<string>): void {
  for (const value of values) {
    target.add(value);
  }
}

function reason(label: string, count: number): string[] {
  if (count <= 0) {
    return [];
  }

  return [`${label}: ${count}`];
}

function itemDate(item: CampaignRecord | ProfileRecord): Date {
  return "createdAt" in item ? item.createdAt : item.updatedAt;
}

function itemId(item: CampaignRecord | ProfileRecord): string {
  return "id" in item ? item.id : item.userId;
}
