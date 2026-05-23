import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import test, { beforeEach } from "node:test";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { MemoryAuthStore } from "../auth/memory-store.test-helper.js";
import { signAccessToken } from "../auth/security.js";
import type { PublicUser, UserRole } from "../auth/types.js";
import { MemoryMarketplaceStore } from "./memory-store.test-helper.js";
import type { ContentLanguage, SocialPlatform } from "./types.js";

const config = loadConfig({
  ACCESS_TOKEN_TTL_SECONDS: "900",
  API_HOST: "127.0.0.1",
  API_PORT: "0",
  COOKIE_SAME_SITE: "lax",
  COOKIE_SECURE: "false",
  DATABASE_URL: "postgresql://unused",
  EMAIL_VERIFICATION_TTL_HOURS: "24",
  JWT_SECRET: "test-secret-with-enough-length",
  NODE_ENV: "test",
  REFRESH_TOKEN_TTL_DAYS: "30",
  WEB_APP_URL: "http://localhost:3000",
  WEB_ORIGIN: "http://localhost:3000"
});

let authStore: MemoryAuthStore;
let marketplaceStore: MemoryMarketplaceStore;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  authStore = new MemoryAuthStore();
  marketplaceStore = new MemoryMarketplaceStore();
  server = createApp({ config, authStore, marketplaceStore }).listen(0);
  await once(server, "listening");
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Expected test server address.");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("profile save succeeds for creator and brand and persists fields", async () => {
  const creator = await createUser("creator");
  const brand = await createUser("brand");

  const creatorProfile = await put(
    "/profiles/me",
    {
      displayName: "Creator One",
      avatarUrl: "https://cdn.example.com/avatar.jpg",
      bio: "Short creator bio",
      socialLinks: {
        tiktok: "https://tiktok.com/@creator",
        youtube: "https://youtube.com/@creator"
      }
    },
    creator.token
  );
  assert.equal(creatorProfile.status, 200);
  assert.equal(creatorProfile.body.profile.displayName, "Creator One");
  assert.equal(creatorProfile.body.profile.role, "creator");

  const brandProfile = await put(
    "/profiles/me",
    {
      displayName: "Brand Co",
      avatarUrl: "",
      bio: "",
      socialLinks: {
        website: "https://brand.example.com"
      }
    },
    brand.token
  );
  assert.equal(brandProfile.status, 200);
  assert.equal(brandProfile.body.profile.displayName, "Brand Co");
  assert.equal(brandProfile.body.profile.role, "brand");

  const persisted = await get("/profiles/me", brand.token);
  assert.equal(persisted.body.profile.socialLinks.website, "https://brand.example.com/");
});

test("profile validation rejects long bio and invalid social or avatar URLs", async () => {
  const creator = await createUser("creator");

  const longBio = await put(
    "/profiles/me",
    {
      displayName: "Creator",
      bio: "x".repeat(501),
      socialLinks: {}
    },
    creator.token
  );
  assert.equal(longBio.status, 400);
  assert.equal(longBio.body.error.code, "INVALID_PAYLOAD");

  const badAvatar = await put(
    "/profiles/me",
    {
      displayName: "Creator",
      avatarUrl: "ftp://example.com/avatar.jpg",
      bio: "",
      socialLinks: {}
    },
    creator.token
  );
  assert.equal(badAvatar.status, 400);

  const badSocial = await put(
    "/profiles/me",
    {
      displayName: "Creator",
      bio: "",
      socialLinks: {
        tiktok: "not-a-url"
      }
    },
    creator.token
  );
  assert.equal(badSocial.status, 400);
});

test("profile matching fields persist and validate ranges and platforms", async () => {
  const creator = await createUser("creator");

  const saved = await put(
    "/profiles/me",
    {
      displayName: "Gaming Creator",
      bio: "",
      socialLinks: {},
      niches: ["Gaming", "apps", "gaming"],
      languages: ["ru", "en"],
      regions: ["CIS", "Moscow"],
      platforms: ["tiktok", "vk"],
      audienceSize: 1500,
      audienceAgeMin: 13,
      audienceAgeMax: 16
    },
    creator.token
  );
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.profile.niches, ["apps", "gaming"]);
  assert.deepEqual(saved.body.profile.languages, ["en", "ru"]);
  assert.equal(saved.body.profile.audienceSize, 1500);

  const badRange = await put(
    "/profiles/me",
    {
      displayName: "Gaming Creator",
      bio: "",
      socialLinks: {},
      audienceAgeMin: 18,
      audienceAgeMax: 13
    },
    creator.token
  );
  assert.equal(badRange.status, 400);

  const badPlatform = await put(
    "/profiles/me",
    {
      displayName: "Gaming Creator",
      bio: "",
      socialLinks: {},
      platforms: ["unknown"]
    },
    creator.token
  );
  assert.equal(badPlatform.status, 400);
});

test("unauthenticated profile, campaign, and feed requests return 401", async () => {
  assert.equal((await get("/profiles/me")).status, 401);
  assert.equal((await post("/campaigns", validCampaignBody())).status, 401);
  assert.equal((await get("/feed/campaigns")).status, 401);
});

test("creator cannot create campaigns and brand can create a valid campaign", async () => {
  const creator = await createUser("creator");
  const brand = await createUser("brand");

  const forbidden = await post("/campaigns", validCampaignBody(), creator.token);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error.code, "WRONG_ROLE");

  const created = await post("/campaigns", validCampaignBody(), brand.token);
  assert.equal(created.status, 201);
  assert.equal(created.body.campaign.title, "Launch video");
  assert.equal(created.body.campaign.categories.join(","), "app,gaming");
  assert.equal(created.body.campaign.budgetCents, 50000);
  assert.equal(created.body.campaign.mediaType, "video");
  assert.equal(created.body.campaign.language, "both");
  assert.equal(created.body.campaign.contentFormat, "short_video");
});

test("campaign target fields persist and campaign feed filters use them", async () => {
  const creator = await createUser("creator");
  const brand = await createUser("brand");
  const matched = await post(
    "/campaigns",
    validCampaignBody({
      title: "RU gaming clip",
      budget: 500,
      language: "ru",
      contentFormat: "short_video",
      targetRegions: ["cis", "moscow"],
      targetPlatforms: ["tiktok"],
      targetInterests: ["gaming"],
      targetAudienceAgeMin: 13,
      targetAudienceAgeMax: 16,
      minAudienceSize: 100,
      maxAudienceSize: 5000
    }),
    brand.token
  );
  assert.equal(matched.status, 201);
  assert.equal(matched.body.campaign.language, "ru");
  assert.deepEqual(matched.body.campaign.targetPlatforms, ["tiktok"]);

  await post(
    "/campaigns",
    validCampaignBody({
      title: "EN review",
      budget: 150000,
      language: "en",
      contentFormat: "review",
      targetRegions: ["usa"],
      targetPlatforms: ["youtube"]
    }),
    brand.token
  );

  const filtered = await get(
    "/feed/campaigns?category=gaming&budgetMin=100&budgetMax=700&language=ru&format=short_video&region=cis&platform=tiktok",
    creator.token
  );
  assert.equal(filtered.status, 200);
  assert.deepEqual(
    filtered.body.campaigns.map((campaign) => campaign.title),
    ["RU gaming clip"]
  );

  const invalidRange = await post(
    "/campaigns",
    validCampaignBody({ minAudienceSize: 1000, maxAudienceSize: 10 }),
    brand.token
  );
  assert.equal(invalidRange.status, 400);
});

test("campaign validation rejects invalid budget, categories, deadline, and media", async () => {
  const brand = await createUser("brand");

  for (const body of [
    { ...validCampaignBody(), budget: 0 },
    { ...validCampaignBody(), categories: [] },
    { ...validCampaignBody(), deadline: "2020-01-01T00:00:00.000Z" },
    { ...validCampaignBody(), mediaUrl: "https://example.com/file.txt" }
  ]) {
    const response = await post("/campaigns", body, brand.token);
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "INVALID_PAYLOAD");
  }
});

test("non-owner brand cannot edit another brand campaign", async () => {
  const owner = await createUser("brand");
  const other = await createUser("brand");
  const created = await post(
    "/campaigns",
    validCampaignBody({ status: "draft" }),
    owner.token
  );
  const campaignId = created.body.campaign.id;
  assert.equal(typeof campaignId, "string");

  const blocked = await patch(
    `/campaigns/${campaignId}`,
    { title: "Stolen edit" },
    other.token
  );
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, "FORBIDDEN");

  const updated = await patch(
    `/campaigns/${campaignId}`,
    { title: "Owner edit", status: "paused" },
    owner.token
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.body.campaign.title, "Owner edit");
});

test("creator feed returns active campaigns only with stable cursor pagination", async () => {
  const creator = await createUser("creator");
  const brand = await createUser("brand");

  const first = await post(
    "/campaigns",
    validCampaignBody({ title: "First active", mediaUrl: "https://example.com/one.jpg" }),
    brand.token
  );
  const second = await post(
    "/campaigns",
    validCampaignBody({
      title: "Second active",
      mediaUrl: "https://example.com/two.jpg"
    }),
    brand.token
  );
  await post(
    "/campaigns",
    validCampaignBody({ title: "Draft", status: "draft" }),
    brand.token
  );

  setCreatedAt(first.body.campaign.id, "2026-01-02T00:00:00.000Z");
  setCreatedAt(second.body.campaign.id, "2026-01-03T00:00:00.000Z");

  const pageOne = await get("/feed/campaigns?limit=1", creator.token);
  assert.equal(pageOne.status, 200);
  assert.equal(pageOne.body.campaigns.length, 1);
  assert.equal(pageOne.body.campaigns[0]?.title, "Second active");
  assert.equal(typeof pageOne.body.nextCursor, "string");

  const pageTwo = await get(
    `/feed/campaigns?limit=1&cursor=${encodeURIComponent(String(pageOne.body.nextCursor))}`,
    creator.token
  );
  assert.equal(pageTwo.status, 200);
  assert.equal(pageTwo.body.campaigns.length, 1);
  assert.equal(pageTwo.body.campaigns[0]?.title, "First active");
  assert.equal(pageTwo.body.nextCursor, null);

  const malformed = await get("/feed/campaigns?cursor=bad-cursor", creator.token);
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, "INVALID_CURSOR");

  const brandFeed = await get("/feed/campaigns", brand.token);
  assert.equal(brandFeed.status, 403);
  assert.equal(brandFeed.body.error.code, "WRONG_ROLE");
});

test("creator campaign feed ranks matching campaigns above newer unrelated campaigns", async () => {
  const creator = await createUser("creator");
  const brand = await createUser("brand");
  await saveProfile(creator.user.id, "creator", "Gaming Creator", {
    niches: ["gaming"],
    languages: ["ru"],
    regions: ["cis"],
    platforms: ["tiktok"],
    audienceSize: 2500,
    audienceAgeMin: 13,
    audienceAgeMax: 16
  });

  const matching = await post(
    "/campaigns",
    validCampaignBody({
      title: "Gaming brief",
      categories: ["gaming"],
      language: "ru",
      targetRegions: ["cis"],
      targetPlatforms: ["tiktok"],
      targetInterests: ["gaming"],
      targetAudienceAgeMin: 13,
      targetAudienceAgeMax: 16,
      minAudienceSize: 1000,
      maxAudienceSize: 5000
    }),
    brand.token
  );
  const unrelated = await post(
    "/campaigns",
    validCampaignBody({
      title: "Beauty brief",
      categories: ["beauty"],
      language: "en",
      mediaUrl: "https://example.com/beauty.jpg",
      targetRegions: ["usa"],
      targetPlatforms: ["youtube"],
      targetInterests: ["beauty"]
    }),
    brand.token
  );
  setCreatedAt(matching.body.campaign.id, "2026-01-01T00:00:00.000Z");
  setCreatedAt(unrelated.body.campaign.id, "2026-01-02T00:00:00.000Z");

  const feed = await get("/feed/campaigns?limit=10", creator.token);
  assert.equal(feed.status, 200);
  assert.deepEqual(
    feed.body.campaigns.map((campaign) => campaign.title),
    ["Gaming brief", "Beauty brief"]
  );
  assert.ok(
    Number(feed.body.campaigns[0]?.recommendationScore) >
      Number(feed.body.campaigns[1]?.recommendationScore)
  );
  assert.ok(feed.body.campaigns[0]?.recommendationReasons?.length);
  assert.equal(marketplaceStore.recommendationEvents.length, 2);
  assert.equal(marketplaceStore.recommendationEvents[0]?.actorUserId, creator.user.id);
  assert.equal(marketplaceStore.recommendationEvents[0]?.rank, 1);
});

test("creator campaign feed boosts positive history and penalizes disliked terms softly", async () => {
  const creator = await createUser("creator");
  const brand = await createUser("brand");
  const likedSeed = await post(
    "/campaigns",
    validCampaignBody({
      title: "Liked gaming seed",
      categories: ["gaming"],
      mediaUrl: "https://example.com/liked-gaming.jpg",
      targetInterests: ["gaming"]
    }),
    brand.token
  );
  const dislikedSeed = await post(
    "/campaigns",
    validCampaignBody({
      title: "Disliked beauty seed",
      categories: ["beauty"],
      mediaUrl: "https://example.com/disliked-beauty.jpg",
      targetInterests: ["beauty"]
    }),
    brand.token
  );
  const futureBeauty = await post(
    "/campaigns",
    validCampaignBody({
      title: "Future beauty",
      categories: ["beauty"],
      mediaUrl: "https://example.com/future-beauty.jpg",
      targetInterests: ["beauty"]
    }),
    brand.token
  );
  const futureGaming = await post(
    "/campaigns",
    validCampaignBody({
      title: "Future gaming",
      categories: ["gaming"],
      mediaUrl: "https://example.com/future-gaming.jpg",
      targetInterests: ["gaming"]
    }),
    brand.token
  );

  await post(
    "/interactions",
    { targetType: "campaign", targetId: likedSeed.body.campaign.id, action: "like" },
    creator.token
  );
  await post(
    "/interactions",
    {
      targetType: "campaign",
      targetId: dislikedSeed.body.campaign.id,
      action: "dislike"
    },
    creator.token
  );

  const feed = await get("/feed/campaigns?limit=10", creator.token);
  assert.equal(feed.status, 200);
  assert.deepEqual(
    feed.body.campaigns.map((campaign) => campaign.id),
    [futureGaming.body.campaign.id, futureBeauty.body.campaign.id]
  );
});

test("brand creator feed ranks profiles that fit active campaign targets first", async () => {
  const brand = await createUser("brand");
  const matching = await createUser("creator");
  const other = await createUser("creator");

  await post(
    "/campaigns",
    validCampaignBody({
      title: "Gaming target",
      categories: ["gaming"],
      language: "ru",
      targetRegions: ["cis"],
      targetPlatforms: ["tiktok"],
      targetInterests: ["gaming"],
      targetAudienceAgeMin: 13,
      targetAudienceAgeMax: 16,
      minAudienceSize: 1000,
      maxAudienceSize: 5000
    }),
    brand.token
  );
  await saveProfile(matching.user.id, "creator", "Matching Creator", {
    niches: ["gaming"],
    languages: ["ru"],
    regions: ["cis"],
    platforms: ["tiktok"],
    audienceSize: 2500,
    audienceAgeMin: 13,
    audienceAgeMax: 16
  });
  await saveProfile(other.user.id, "creator", "Other Creator", {
    niches: ["beauty"],
    languages: ["en"],
    regions: ["usa"],
    platforms: ["youtube"],
    audienceSize: 9000,
    audienceAgeMin: 25,
    audienceAgeMax: 34
  });

  const feed = await get("/feed/creators?limit=10", brand.token);
  assert.equal(feed.status, 200);
  assert.deepEqual(
    feed.body.profiles.map((profile) => profile.displayName),
    ["Matching Creator", "Other Creator"]
  );
  assert.ok(
    Number(feed.body.profiles[0]?.recommendationScore) >
      Number(feed.body.profiles[1]?.recommendationScore)
  );
  assert.equal(marketplaceStore.recommendationEvents.length, 2);
  assert.equal(marketplaceStore.recommendationEvents[0]?.feedType, "creators");
});

test("like, dislike, and save interactions persist idempotently", async () => {
  const creator = await createUser("creator");
  const brand = await createUser("brand");
  const campaign = await post("/campaigns", validCampaignBody(), brand.token);
  const campaignId = campaign.body.campaign.id;
  assert.ok(campaignId);

  const saved = await post(
    "/interactions",
    { targetType: "campaign", targetId: campaignId, action: "save" },
    creator.token
  );
  assert.equal(saved.status, 201);
  assert.equal(saved.body.interactionCreated, true);

  const savedAgain = await post(
    "/interactions",
    { targetType: "campaign", targetId: campaignId, action: "save" },
    creator.token
  );
  assert.equal(savedAgain.status, 201);
  assert.equal(savedAgain.body.interactionCreated, false);

  const liked = await post(
    "/interactions",
    { targetType: "campaign", targetId: campaignId, action: "like" },
    creator.token
  );
  assert.equal(liked.status, 201);
  assert.equal(liked.body.interactionCreated, true);

  const disliked = await post(
    "/interactions",
    { targetType: "campaign", targetId: campaignId, action: "dislike" },
    creator.token
  );
  assert.equal(disliked.status, 201);
  assert.equal(disliked.body.interactionCreated, true);

  const favorites = await get("/favorites", creator.token);
  assert.equal(favorites.status, 200);
  assert.equal(favorites.body.campaigns.length, 1);
  assert.equal(favorites.body.campaigns[0]?.id, campaignId);
});

test("creator campaign like and brand profile like create exactly one match", async () => {
  const creator = await createUser("creator");
  const brand = await createUser("brand");
  await saveProfile(creator.user.id, "creator", "Creator Match");
  const campaign = await post("/campaigns", validCampaignBody(), brand.token);
  const campaignId = campaign.body.campaign.id;
  assert.ok(campaignId);

  const creatorLike = await post(
    "/interactions",
    { targetType: "campaign", targetId: campaignId, action: "like" },
    creator.token
  );
  assert.equal(creatorLike.status, 201);
  assert.equal(creatorLike.body.matchCreated, false);

  const brandLike = await post(
    "/interactions",
    { targetType: "profile", targetId: creator.user.id, action: "like" },
    brand.token
  );
  assert.equal(brandLike.status, 201);
  assert.equal(brandLike.body.matchCreated, true);
  assert.equal(brandLike.body.matches.length, 1);

  const repeated = await post(
    "/interactions",
    { targetType: "profile", targetId: creator.user.id, action: "like" },
    brand.token
  );
  assert.equal(repeated.status, 201);
  assert.equal(repeated.body.interactionCreated, false);
  assert.equal(repeated.body.matchCreated, false);

  const creatorMatches = await get("/matches", creator.token);
  assert.equal(creatorMatches.status, 200);
  assert.equal(creatorMatches.body.matches.length, 1);
  assert.equal(creatorMatches.body.matches[0]?.match.campaignId, campaignId);

  const brandMatches = await get("/matches", brand.token);
  assert.equal(brandMatches.body.matches.length, 1);
});

test("feed excludes liked and disliked cards but not saved-only cards", async () => {
  const creator = await createUser("creator");
  const brand = await createUser("brand");
  const savedOnly = await post(
    "/campaigns",
    validCampaignBody({ title: "Saved only", mediaUrl: "https://example.com/saved.jpg" }),
    brand.token
  );
  const liked = await post(
    "/campaigns",
    validCampaignBody({ title: "Liked", mediaUrl: "https://example.com/liked.jpg" }),
    brand.token
  );
  const disliked = await post(
    "/campaigns",
    validCampaignBody({
      title: "Disliked",
      mediaUrl: "https://example.com/disliked.jpg"
    }),
    brand.token
  );

  await post(
    "/interactions",
    { targetType: "campaign", targetId: savedOnly.body.campaign.id, action: "save" },
    creator.token
  );
  await post(
    "/interactions",
    { targetType: "campaign", targetId: liked.body.campaign.id, action: "like" },
    creator.token
  );
  await post(
    "/interactions",
    { targetType: "campaign", targetId: disliked.body.campaign.id, action: "dislike" },
    creator.token
  );

  const feed = await get("/feed/campaigns?limit=10", creator.token);
  assert.equal(feed.status, 200);
  assert.deepEqual(
    feed.body.campaigns.map((campaign) => campaign.id),
    [savedOnly.body.campaign.id]
  );
});

test("brand creator feed excludes liked and disliked profiles and supports favorites", async () => {
  const brand = await createUser("brand");
  const savedCreator = await createUser("creator");
  const likedCreator = await createUser("creator");
  const dislikedCreator = await createUser("creator");
  await saveProfile(savedCreator.user.id, "creator", "Saved Creator");
  await saveProfile(likedCreator.user.id, "creator", "Liked Creator");
  await saveProfile(dislikedCreator.user.id, "creator", "Disliked Creator");

  await post(
    "/interactions",
    { targetType: "profile", targetId: savedCreator.user.id, action: "save" },
    brand.token
  );
  await post(
    "/interactions",
    { targetType: "profile", targetId: likedCreator.user.id, action: "like" },
    brand.token
  );
  await post(
    "/interactions",
    { targetType: "profile", targetId: dislikedCreator.user.id, action: "dislike" },
    brand.token
  );

  const feed = await get("/feed/creators?limit=10", brand.token);
  assert.equal(feed.status, 200);
  assert.deepEqual(
    feed.body.profiles.map((profile) => profile.userId),
    [savedCreator.user.id]
  );

  const favorites = await get("/favorites", brand.token);
  assert.equal(favorites.status, 200);
  assert.equal(favorites.body.profiles.length, 1);
  assert.equal(favorites.body.profiles[0]?.userId, savedCreator.user.id);
});

test("brand creator feed filters by matching profile fields", async () => {
  const brand = await createUser("brand");
  const matching = await createUser("creator");
  const other = await createUser("creator");
  await marketplaceStore.upsertProfile({
    userId: matching.user.id,
    role: "creator",
    displayName: "Matching Creator",
    avatarUrl: null,
    bio: "",
    socialLinks: {},
    niches: ["gaming"],
    languages: ["ru"],
    regions: ["cis"],
    platforms: ["tiktok"],
    audienceSize: 2500,
    audienceAgeMin: 13,
    audienceAgeMax: 16
  });
  await marketplaceStore.upsertProfile({
    userId: other.user.id,
    role: "creator",
    displayName: "Other Creator",
    avatarUrl: null,
    bio: "",
    socialLinks: {},
    niches: ["beauty"],
    languages: ["en"],
    regions: ["usa"],
    platforms: ["youtube"],
    audienceSize: 9000,
    audienceAgeMin: null,
    audienceAgeMax: null
  });

  const feed = await get(
    "/feed/creators?niche=gaming&language=ru&region=cis&platform=tiktok&audienceMin=1000&audienceMax=3000",
    brand.token
  );
  assert.equal(feed.status, 200);
  assert.deepEqual(
    feed.body.profiles.map((profile) => profile.displayName),
    ["Matching Creator"]
  );
});

test("invalid interactions and wrong-role interactions are rejected", async () => {
  const creator = await createUser("creator");
  const brand = await createUser("brand");
  await saveProfile(creator.user.id, "creator", "Creator");

  const creatorProfileLike = await post(
    "/interactions",
    { targetType: "profile", targetId: creator.user.id, action: "like" },
    creator.token
  );
  assert.equal(creatorProfileLike.status, 403);
  assert.equal(creatorProfileLike.body.error.code, "WRONG_ROLE");

  const brandCampaignLike = await post(
    "/interactions",
    {
      targetType: "campaign",
      targetId: "00000000-0000-0000-0000-000000000001",
      action: "like"
    },
    brand.token
  );
  assert.equal(brandCampaignLike.status, 403);
  assert.equal(brandCampaignLike.body.error.code, "WRONG_ROLE");

  const badAction = await post(
    "/interactions",
    { targetType: "profile", targetId: creator.user.id, action: "superlike" },
    brand.token
  );
  assert.equal(badAction.status, 400);
  assert.equal(badAction.body.error.code, "INVALID_PAYLOAD");

  const missingTarget = await post(
    "/interactions",
    {
      targetType: "profile",
      targetId: "00000000-0000-0000-0000-000000000999",
      action: "like"
    },
    brand.token
  );
  assert.equal(missingTarget.status, 404);
});

async function createUser(role: UserRole): Promise<{ user: PublicUser; token: string }> {
  const user = {
    id: randomUUID(),
    email: `${role}-${randomUUID()}@example.com`,
    emailVerified: true,
    role,
    status: "active",
    isMinor: false,
    parentalConsentGranted: true,
    totpEnabled: false
  } satisfies PublicUser;

  await authStore.createUser({
    id: user.id,
    email: user.email,
    passwordHash: "unused",
    role,
    dateOfBirth: null
  });
  await authStore.updateUserEmailVerified(user.id, new Date());

  return {
    user,
    token: await signAccessToken(user, config)
  };
}

function validCampaignBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "Launch video",
    description: "Create a short vertical UGC video.",
    categories: ["Gaming", "app", "gaming"],
    budget: 500,
    deadline: "2035-01-01T00:00:00.000Z",
    mediaUrl: "https://example.com/brief.mp4",
    status: "active",
    ...overrides
  };
}

function setCreatedAt(id: string | undefined, value: string): void {
  assert.ok(id);
  const campaign = marketplaceStore.campaigns.get(id);
  assert.ok(campaign);
  marketplaceStore.campaigns.set(id, {
    ...campaign,
    createdAt: new Date(value)
  });
}

async function saveProfile(
  userId: string,
  role: UserRole,
  displayName: string,
  overrides: Partial<{
    avatarUrl: string | null;
    bio: string;
    socialLinks: Record<string, string>;
    niches: string[];
    languages: ContentLanguage[];
    regions: string[];
    platforms: SocialPlatform[];
    audienceSize: number | null;
    audienceAgeMin: number | null;
    audienceAgeMax: number | null;
  }> = {}
) {
  await marketplaceStore.upsertProfile({
    userId,
    role,
    displayName,
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
    ...overrides
  });
}

async function get(path: string, accessToken?: string) {
  return request("GET", path, undefined, accessToken);
}

async function post(path: string, body?: unknown, accessToken?: string) {
  return request("POST", path, body, accessToken);
}

async function put(path: string, body: unknown, accessToken: string) {
  return request("PUT", path, body, accessToken);
}

async function patch(path: string, body: unknown, accessToken: string) {
  return request("PATCH", path, body, accessToken);
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  accessToken?: string
): Promise<{
  status: number;
  body: TestResponseBody;
}> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    }
  });
  const text = await response.text();

  return {
    status: response.status,
    body: text ? JSON.parse(text) : {}
  };
}

type TestResponseBody = {
  campaign: {
    budgetCents?: number;
    categories: string[];
    contentFormat?: string;
    id?: string;
    language?: string;
    mediaType?: string;
    targetPlatforms?: string[];
    title?: string;
  };
  campaigns: Array<{
    id?: string;
    recommendationReasons?: string[];
    recommendationScore?: number;
    title?: string;
  }>;
  interactionCreated?: boolean;
  matchCreated?: boolean;
  matches: Array<{
    match: {
      campaignId?: string;
    };
  }>;
  error: {
    code?: string;
  };
  nextCursor?: string | null;
  profile: {
    audienceSize?: number;
    displayName?: string;
    languages?: string[];
    niches?: string[];
    role?: string;
    socialLinks: {
      website?: string;
    };
  };
  profiles: Array<{
    displayName?: string;
    recommendationScore?: number;
    userId?: string;
  }>;
};
