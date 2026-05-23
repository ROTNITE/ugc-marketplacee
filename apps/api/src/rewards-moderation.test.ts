import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import test, { beforeEach } from "node:test";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryAuthStore } from "./auth/memory-store.test-helper.js";
import { signAccessToken } from "./auth/security.js";
import type { PublicUser, UserRole } from "./auth/types.js";
import { ChatService } from "./chat/service.js";
import { MemoryChatStore } from "./chat/memory-store.test-helper.js";
import { MemoryMarketplaceStore } from "./marketplace/memory-store.test-helper.js";
import { MemoryPaymentStore } from "./payments/memory-store.test-helper.js";
import { PaymentService } from "./payments/service.js";
import { MemoryRewardsStore } from "./rewards/memory-store.test-helper.js";
import { RewardsService } from "./rewards/service.js";
import { MemoryModerationStore } from "./moderation/memory-store.test-helper.js";
import { ModerationService } from "./moderation/service.js";

const config = loadConfig({
  ACCESS_TOKEN_TTL_SECONDS: "900",
  ADMIN_EMAILS: "admin@example.com",
  API_HOST: "127.0.0.1",
  API_PORT: "0",
  BANNED_KEYWORDS: "casino,drugs",
  COOKIE_SAME_SITE: "lax",
  COOKIE_SECURE: "false",
  DATABASE_URL: "postgresql://unused",
  EMAIL_VERIFICATION_TTL_HOURS: "24",
  JWT_SECRET: "test-secret-with-enough-length",
  NODE_ENV: "test",
  PLATFORM_COMMISSION_PERCENT: "10",
  REFERRAL_SIGNUP_BONUS_CREDITS: "50",
  REFRESH_TOKEN_TTL_DAYS: "30",
  STRIPE_SECRET_KEY: "sk_test_unused",
  STRIPE_WEBHOOK_SECRET: "whsec_unused",
  WEB_APP_URL: "http://localhost:3000",
  WEB_ORIGIN: "http://localhost:3000"
});

let authStore: MemoryAuthStore;
let marketplaceStore: MemoryMarketplaceStore;
let chatStore: MemoryChatStore;
let paymentStore: MemoryPaymentStore;
let rewardsStore: MemoryRewardsStore;
let moderationStore: MemoryModerationStore;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  authStore = new MemoryAuthStore();
  marketplaceStore = new MemoryMarketplaceStore();
  chatStore = new MemoryChatStore();
  paymentStore = new MemoryPaymentStore();
  rewardsStore = new MemoryRewardsStore();
  moderationStore = new MemoryModerationStore();

  const rewardsService = new RewardsService(rewardsStore, config);
  const paymentService = new PaymentService(
    paymentStore,
    marketplaceStore,
    config,
    rewardsService
  );
  const chatService = new ChatService(chatStore, marketplaceStore);
  const moderationService = new ModerationService(
    moderationStore,
    authStore,
    marketplaceStore,
    chatStore
  );

  server = createApp({
    config,
    authStore,
    chatService,
    marketplaceStore,
    paymentService,
    rewardsService,
    moderationService
  }).listen(0);
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

test("referral signup records referrer, awards verified users, and admin allowlist/ban works", async () => {
  const adminSignupBlocked = await post("/auth/register", {
    email: "not-admin@example.com",
    password: "password123",
    role: "admin"
  });
  assert.equal(adminSignupBlocked.status, 400);

  await registerAndVerify("referrer@example.com", "creator");
  const referrerLogin = await post("/auth/login", {
    email: "referrer@example.com",
    password: "password123"
  });
  const referralSummary = await get(
    "/referrals/me",
    referrerLogin.body.accessToken as string
  );
  assert.equal(referralSummary.status, 200);
  assert.equal(typeof referralSummary.body.referrals.code, "string");

  await registerAndVerify("referred@example.com", "brand", {
    referralCode: referralSummary.body.referrals.code
  });
  const referredLogin = await post("/auth/login", {
    email: "referred@example.com",
    password: "password123"
  });
  const referrerLedger = await get(
    "/rewards/ledger",
    referrerLogin.body.accessToken as string
  );
  const referredLedger = await get(
    "/rewards/ledger",
    referredLogin.body.accessToken as string
  );
  assert.equal(referrerLedger.body.creditBalance, 50);
  assert.equal(referredLedger.body.creditBalance, 50);
  assert.equal(referrerLedger.body.entries[0]?.type, "referral_bonus");

  await registerAndVerify("admin@example.com", "brand");
  const adminLogin = await post("/auth/login", {
    email: "admin@example.com",
    password: "password123"
  });
  assert.equal(adminLogin.body.user.role, "admin");

  const banned = await post(
    `/admin/users/${referredLogin.body.user.id}/ban`,
    {},
    adminLogin.body.accessToken as string
  );
  assert.equal(banned.status, 200);
  assert.equal(banned.body.user.status, "banned");

  const blocked = await get("/auth/me", referredLogin.body.accessToken as string);
  assert.equal(blocked.status, 401);
});

test("moderation reports, admin queue, banned keyword rejection, and action log work", async () => {
  const admin = await createUser("admin");
  const brand = await createUser("brand");
  const creator = await createUser("creator");
  const campaign = await post(
    "/campaigns",
    validCampaignBody({
      title: "Casino launch",
      description: "Create a casino promo"
    }),
    brand.token
  );
  assert.equal(campaign.status, 201);
  assert.equal(campaign.body.campaign.status, "rejected");
  assert.match(campaign.body.campaign.moderationReason, /casino/);

  const feed = await get("/feed/campaigns", creator.token);
  assert.equal(feed.status, 200);
  assert.equal(feed.body.campaigns.length, 0);

  const report = await post(
    "/moderation/reports",
    {
      targetType: "campaign",
      targetId: campaign.body.campaign.id,
      reason: "Unsafe brief",
      details: "Looks suspicious"
    },
    creator.token
  );
  assert.equal(report.status, 201);

  const reports = await get("/admin/reports", admin.token);
  assert.equal(reports.status, 200);
  assert.equal(reports.body.reports.length, 1);

  const resolved = await post(
    `/admin/reports/${report.body.report.id}/resolve`,
    { status: "actioned", adminNote: "Rejected already" },
    admin.token
  );
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.report.status, "actioned");

  const actions = await get("/admin/actions", admin.token);
  assert.equal(actions.status, 200);
  assert.equal(actions.body.actions[0]?.actionType, "report_actioned");

  const campaigns = await get("/admin/campaigns?status=rejected", admin.token);
  assert.equal(campaigns.body.campaigns.length, 1);

  const updated = await patch(
    `/admin/campaigns/${campaign.body.campaign.id}`,
    { status: "paused", moderationReason: "Manual pause" },
    admin.token
  );
  assert.equal(updated.body.campaign.status, "paused");
});

test("chat message reports are participant-only and reward credits offset commission", async () => {
  const admin = await createUser("admin");
  const fixture = await createMatchedFixture();
  const thread = await post(
    "/chat/threads",
    { matchId: fixture.matchId },
    fixture.brand.token
  );
  const message = await post(
    `/chat/threads/${thread.body.thread.thread.id}/messages`,
    { body: "Please review this brief" },
    fixture.brand.token
  );

  const report = await post(
    "/moderation/reports",
    {
      targetType: "chat_message",
      targetId: message.body.message.id,
      reason: "Bad message"
    },
    fixture.creator.token
  );
  assert.equal(report.status, 201);

  const outsider = await createUser("creator");
  const blocked = await post(
    "/moderation/reports",
    {
      targetType: "chat_message",
      targetId: message.body.message.id,
      reason: "Cannot see it"
    },
    outsider.token
  );
  assert.equal(blocked.status, 404);

  await rewardsStore.createLedgerEntry({
    id: randomUUID(),
    userId: fixture.creator.user.id,
    type: "manual_adjustment",
    amountCredits: 50
  });
  const funded = await post(
    "/payments/escrow/fund",
    { matchId: fixture.matchId, amountCents: 50000 },
    fixture.brand.token
  );
  await post(
    "/deliverables",
    {
      matchId: fixture.matchId,
      url: "https://example.com/final.mp4",
      note: "Ready"
    },
    fixture.creator.token
  );
  const released = await post(
    "/payments/escrow/release",
    { escrowHoldId: funded.body.escrowHold.id },
    fixture.brand.token
  );
  assert.equal(released.status, 200);
  assert.equal(released.body.transaction.amountCents, 50000);
  assert.equal(released.body.transaction.metadata.creditsApplied, 50);
  assert.equal(paymentStore.platformFees.size, 0);

  const badges = await get("/achievements/me", fixture.creator.token);
  assert.equal(badges.body.badges[0]?.badgeKey, "first_completed_campaign");

  const adminReports = await get("/admin/reports?targetType=chat_message", admin.token);
  assert.equal(adminReports.body.reports.length, 1);
});

test("gamification progress is lazy and profile completion is awarded once", async () => {
  const creator = await createUser("creator");

  const empty = await get("/gamification/me", creator.token);
  assert.equal(empty.status, 200);
  assert.equal(empty.body.progress.level, 1);
  assert.equal(empty.body.progress.xp, 0);

  const saved = await put(
    "/profiles/me",
    {
      displayName: "Creator One",
      bio: "UGC for games",
      socialLinks: {},
      niches: ["gaming"]
    },
    creator.token
  );
  assert.equal(saved.status, 200);

  await put(
    "/profiles/me",
    {
      displayName: "Creator One",
      bio: "UGC for games",
      socialLinks: {},
      niches: ["gaming"]
    },
    creator.token
  );

  const summary = await get("/gamification/me", creator.token);
  assert.equal(summary.body.progress.xp, 20);
  assert.equal(summary.body.progress.currentStreak, 1);
  assert.ok(
    summary.body.badges.some(
      (badge: { badgeKey: string }) => badge.badgeKey === "profile_completed"
    )
  );
});

test("campaign, funding, release, leaderboard, and swipe cap award gamification", async () => {
  const fixture = await createMatchedFixture();
  rewardsStore.leaderboardProfiles.set(fixture.creator.user.id, {
    displayName: "Creator Leader",
    role: "creator"
  });
  rewardsStore.leaderboardProfiles.set(fixture.brand.user.id, {
    displayName: "Brand Leader",
    role: "brand"
  });

  const campaign = await post("/campaigns", validCampaignBody(), fixture.brand.token);
  assert.equal(campaign.status, 201);

  for (let index = 0; index < 25; index += 1) {
    const swipeCampaign = await marketplaceStore.createCampaign({
      id: randomUUID(),
      ownerUserId: fixture.brand.user.id,
      title: `Swipe ${index}`,
      description: "Swipe test",
      categories: ["gaming"],
      budgetCents: 50000,
      deadline: new Date("2035-01-01T00:00:00.000Z"),
      mediaUrl: `https://example.com/swipe-${index}.jpg`,
      mediaType: "image",
      status: "active",
      moderationReason: null,
      language: "both",
      contentFormat: "short_video",
      targetRegions: [],
      targetPlatforms: [],
      targetInterests: [],
      targetAudienceAgeMin: null,
      targetAudienceAgeMax: null,
      minAudienceSize: null,
      maxAudienceSize: null
    });
    await post(
      "/interactions",
      { targetType: "campaign", targetId: swipeCampaign.id, action: "save" },
      fixture.creator.token
    );
  }

  const funded = await post(
    "/payments/escrow/fund",
    { matchId: fixture.matchId, amountCents: 50000 },
    fixture.brand.token
  );
  await post(
    "/deliverables",
    {
      matchId: fixture.matchId,
      url: "https://example.com/final.mp4",
      note: "Ready"
    },
    fixture.creator.token
  );
  await post(
    "/payments/escrow/release",
    { escrowHoldId: funded.body.escrowHold.id },
    fixture.brand.token
  );

  const creatorSummary = await get("/gamification/me", fixture.creator.token);
  assert.equal(creatorSummary.body.progress.xp, 120);
  assert.equal(creatorSummary.body.progress.reputationScore, 100);
  assert.equal(creatorSummary.body.progress.level, 2);

  const brandSummary = await get("/gamification/me", fixture.brand.token);
  assert.equal(brandSummary.body.progress.xp, 70);

  const leaderboard = await get(
    "/gamification/leaderboard?role=creator",
    fixture.creator.token
  );
  assert.equal(leaderboard.status, 200);
  assert.equal(leaderboard.body.entries[0]?.userId, fixture.creator.user.id);
});

test("gamification streaks advance by activity day and award streak badges", async () => {
  const store = new MemoryRewardsStore();
  let now = new Date("2026-01-01T10:00:00.000Z");
  const service = new RewardsService(store, config, () => now);
  const userId = randomUUID();

  for (let day = 0; day < 7; day += 1) {
    now = new Date(`2026-01-${String(day + 1).padStart(2, "0")}T10:00:00.000Z`);
    await service.awardSwipeAction({
      userId,
      targetType: "campaign",
      targetId: randomUUID(),
      action: "save"
    });
  }

  const summary = await service.getGamificationSummary(userId);
  assert.equal(summary.progress.currentStreak, 7);
  assert.equal(summary.progress.longestStreak, 7);
  assert.ok(summary.badges.some((badge) => badge.badgeKey === "streak_3"));
  assert.ok(summary.badges.some((badge) => badge.badgeKey === "streak_7"));
});

async function registerAndVerify(
  email: string,
  role: "creator" | "brand",
  extra: Record<string, unknown> = {}
) {
  const registered = await post("/auth/register", {
    email,
    password: "password123",
    role,
    ...extra
  });
  assert.equal(registered.status, 201);
  const token = authStore.emailOutbox[0]?.token;
  assert.ok(token);
  const verified = await post("/auth/verify-email", { token });
  assert.equal(verified.status, 200);
  return verified;
}

async function createMatchedFixture() {
  const creator = await createUser("creator");
  const brand = await createUser("brand");
  const campaign = await marketplaceStore.createCampaign({
    id: randomUUID(),
    ownerUserId: brand.user.id,
    title: "Launch video",
    description: "Create a short vertical UGC video.",
    categories: ["gaming"],
    budgetCents: 50000,
    deadline: new Date("2035-01-01T00:00:00.000Z"),
    mediaUrl: "https://example.com/brief.mp4",
    mediaType: "video",
    status: "active",
    moderationReason: null,
    language: "both",
    contentFormat: "short_video",
    targetRegions: [],
    targetPlatforms: [],
    targetInterests: [],
    targetAudienceAgeMin: null,
    targetAudienceAgeMax: null,
    minAudienceSize: null,
    maxAudienceSize: null
  });
  const { match } = await marketplaceStore.createMatch({
    id: randomUUID(),
    creatorUserId: creator.user.id,
    brandUserId: brand.user.id,
    campaignId: campaign.id
  });

  return { brand, creator, matchId: match.id };
}

async function createUser(role: UserRole): Promise<{ user: PublicUser; token: string }> {
  const user = {
    id: randomUUID(),
    email: `${role}-${randomUUID()}@example.com`,
    emailVerified: true,
    role,
    status: "active"
  } satisfies PublicUser;

  await authStore.createUser({
    id: user.id,
    email: user.email,
    passwordHash: "unused",
    role
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
    categories: ["gaming"],
    budget: 500,
    deadline: "2035-01-01T00:00:00.000Z",
    mediaUrl: "https://example.com/brief.mp4",
    status: "active",
    ...overrides
  };
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
  // Tests intentionally inspect heterogeneous JSON response bodies.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>;
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
