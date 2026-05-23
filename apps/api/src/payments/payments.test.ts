import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import test, { beforeEach } from "node:test";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { MemoryAuthStore } from "../auth/memory-store.test-helper.js";
import { signAccessToken } from "../auth/security.js";
import type { PublicUser, UserRole } from "../auth/types.js";
import { MemoryMarketplaceStore } from "../marketplace/memory-store.test-helper.js";
import { PaymentService } from "./service.js";
import { MemoryPaymentStore } from "./memory-store.test-helper.js";

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
  PLATFORM_COMMISSION_PERCENT: "10",
  REFRESH_TOKEN_TTL_DAYS: "30",
  STRIPE_SECRET_KEY: "sk_test_unused",
  STRIPE_WEBHOOK_SECRET: "whsec_unused",
  WEB_APP_URL: "http://localhost:3000",
  WEB_ORIGIN: "http://localhost:3000"
});

let authStore: MemoryAuthStore;
let marketplaceStore: MemoryMarketplaceStore;
let paymentStore: MemoryPaymentStore;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  authStore = new MemoryAuthStore();
  marketplaceStore = new MemoryMarketplaceStore();
  paymentStore = new MemoryPaymentStore();
  const paymentService = new PaymentService(paymentStore, marketplaceStore, config);
  server = createApp({
    config,
    authStore,
    marketplaceStore,
    paymentService
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

test("brand funds own match and duplicate, creator, and outsider funding are rejected", async () => {
  const fixture = await createMatchedFixture();

  const funded = await post(
    "/payments/escrow/fund",
    { matchId: fixture.matchId, amountCents: 50000 },
    fixture.brand.token
  );
  assert.equal(funded.status, 201);
  assert.equal(funded.body.transaction.status, "completed");
  assert.equal(funded.body.escrowHold.creatorUserId, fixture.creator.user.id);
  assert.equal(funded.body.escrowHold.commissionCents, 5000);

  const duplicate = await post(
    "/payments/escrow/fund",
    { matchId: fixture.matchId, amountCents: 50000 },
    fixture.brand.token
  );
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.error.code, "ESCROW_EXISTS");

  const creatorBlocked = await post(
    "/payments/escrow/fund",
    { matchId: fixture.matchId, amountCents: 50000 },
    fixture.creator.token
  );
  assert.equal(creatorBlocked.status, 403);

  const outsider = await createUser("brand");
  const outsiderBlocked = await post(
    "/payments/escrow/fund",
    { matchId: fixture.matchId, amountCents: 50000 },
    outsider.token
  );
  assert.equal(outsiderBlocked.status, 404);
});

test("creator submits deliverable and participant-only reads are enforced", async () => {
  const fixture = await createMatchedFixture();

  const brandSubmit = await post(
    "/deliverables",
    { matchId: fixture.matchId, url: "https://example.com/video.mp4" },
    fixture.brand.token
  );
  assert.equal(brandSubmit.status, 403);

  const submitted = await post(
    "/deliverables",
    {
      matchId: fixture.matchId,
      url: "https://example.com/video.mp4",
      note: "First draft"
    },
    fixture.creator.token
  );
  assert.equal(submitted.status, 201);
  assert.equal(submitted.body.deliverable.status, "submitted");
  assert.equal(submitted.body.deliverable.url, "https://example.com/video.mp4");

  const read = await get(`/deliverables/match/${fixture.matchId}`, fixture.brand.token);
  assert.equal(read.status, 200);
  assert.equal(read.body.deliverable.note, "First draft");

  const outsider = await createUser("creator");
  const outsiderRead = await get(
    `/deliverables/match/${fixture.matchId}`,
    outsider.token
  );
  assert.equal(outsiderRead.status, 404);
});

test("release requires deliverable and credits creator net balance", async () => {
  const fixture = await createMatchedFixture();
  const funded = await fund(fixture);
  const blockedRelease = await post(
    "/payments/escrow/release",
    { escrowHoldId: funded.body.escrowHold.id },
    fixture.brand.token
  );
  assert.equal(blockedRelease.status, 400);
  assert.equal(blockedRelease.body.error.code, "DELIVERABLE_REQUIRED");

  await submitDeliverable(fixture);
  const released = await post(
    "/payments/escrow/release",
    { escrowHoldId: funded.body.escrowHold.id },
    fixture.brand.token
  );
  assert.equal(released.status, 200);
  assert.equal(released.body.escrowHold.status, "released");

  const balance = await get("/payments/balance", fixture.creator.token);
  assert.equal(balance.body.balance.balanceCents, 45000);
  assert.equal(balance.body.balance.totalEarnedCents, 45000);
  assert.equal(paymentStore.platformFees.size, 1);

  const deliverable = await get(
    `/deliverables/match/${fixture.matchId}`,
    fixture.creator.token
  );
  assert.equal(deliverable.body.deliverable.status, "approved");
});

test("refund rejects later release and marks deliverable rejected", async () => {
  const fixture = await createMatchedFixture();
  const funded = await fund(fixture);
  await submitDeliverable(fixture);

  const refunded = await post(
    "/payments/escrow/refund",
    { escrowHoldId: funded.body.escrowHold.id, reason: "Cancelled" },
    fixture.brand.token
  );
  assert.equal(refunded.status, 200);
  assert.equal(refunded.body.escrowHold.status, "refunded");

  const releaseAfterRefund = await post(
    "/payments/escrow/release",
    { escrowHoldId: funded.body.escrowHold.id },
    fixture.brand.token
  );
  assert.equal(releaseAfterRefund.status, 400);

  const deliverable = await get(
    `/deliverables/match/${fixture.matchId}`,
    fixture.brand.token
  );
  assert.equal(deliverable.body.deliverable.status, "rejected");
});

test("payout and transactions are scoped to the current user", async () => {
  const fixture = await createMatchedFixture();
  const funded = await fund(fixture);
  await submitDeliverable(fixture);
  await post(
    "/payments/escrow/release",
    { escrowHoldId: funded.body.escrowHold.id },
    fixture.brand.token
  );

  const insufficient = await post(
    "/payments/payout",
    { amountCents: 999999 },
    fixture.creator.token
  );
  assert.equal(insufficient.status, 400);

  const payout = await post(
    "/payments/payout",
    { amountCents: 10000 },
    fixture.creator.token
  );
  assert.equal(payout.status, 201);
  assert.equal(payout.body.transaction.status, "completed");

  const balance = await get("/payments/balance", fixture.creator.token);
  assert.equal(balance.body.balance.balanceCents, 35000);
  assert.equal(balance.body.balance.pendingCents, 0);
  assert.equal(balance.body.balance.totalWithdrawnCents, 10000);

  const creatorTransactions = await get("/payments/transactions", fixture.creator.token);
  assert.deepEqual(
    creatorTransactions.body.transactions.map((transaction) => transaction.type).sort(),
    ["escrow_release", "payout"]
  );

  const brandTransactions = await get("/payments/transactions", fixture.brand.token);
  assert.deepEqual(
    brandTransactions.body.transactions.map((transaction) => transaction.type),
    ["deposit"]
  );
});

async function fund(fixture: MatchedFixture) {
  return post(
    "/payments/escrow/fund",
    { matchId: fixture.matchId, amountCents: 50000 },
    fixture.brand.token
  );
}

async function submitDeliverable(fixture: MatchedFixture) {
  return post(
    "/deliverables",
    {
      matchId: fixture.matchId,
      url: "https://example.com/final.mp4",
      note: "Ready"
    },
    fixture.creator.token
  );
}

async function createMatchedFixture(): Promise<MatchedFixture> {
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

async function get(path: string, accessToken?: string) {
  return request("GET", path, undefined, accessToken);
}

async function post(path: string, body?: unknown, accessToken?: string) {
  return request("POST", path, body, accessToken);
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

type MatchedFixture = {
  brand: { user: PublicUser; token: string };
  creator: { user: PublicUser; token: string };
  matchId: string;
};

type TestResponseBody = {
  balance: {
    balanceCents: number;
    pendingCents: number;
    totalEarnedCents: number;
    totalWithdrawnCents: number;
  };
  deliverable: {
    note?: string;
    status?: string;
    url?: string;
  };
  error: {
    code?: string;
  };
  escrowHold: {
    commissionCents?: number;
    creatorUserId?: string;
    id?: string;
    status?: string;
  };
  transaction: {
    status?: string;
  };
  transactions: Array<{
    type: string;
  }>;
};
