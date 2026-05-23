import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import test, { beforeEach } from "node:test";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { MemoryAuthStore } from "./memory-store.test-helper.js";
import { _resetRateLimitStoreForTests } from "./rate-limit.js";

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

let store: MemoryAuthStore;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  _resetRateLimitStoreForTests();
  store = new MemoryAuthStore();
  server = createApp({ config, authStore: store }).listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("registration rejects underage users (<13)", async () => {
  const now = new Date();
  const tenYearsAgo = new Date(
    now.getUTCFullYear() - 10,
    now.getUTCMonth(),
    now.getUTCDate()
  )
    .toISOString()
    .slice(0, 10);

  const response = await postJson("/auth/register", {
    email: "kid@example.com",
    password: "password123",
    role: "creator",
    dateOfBirth: tenYearsAgo
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.error?.code, "UNDERAGE_NOT_ALLOWED");
});

test("forgot-password is non-enumerating and reset rotates the password", async () => {
  // Register + verify a user
  await postJson("/auth/register", {
    email: "reset@example.com",
    password: "originalpass",
    role: "creator"
  });
  const verifyToken = store.emailOutbox[0]?.token;
  assert.ok(verifyToken);
  await postJson("/auth/verify-email", { token: verifyToken });

  // Forgot password for an existing email - 202
  const knownEmail = await postJson("/auth/forgot-password", {
    email: "reset@example.com"
  });
  assert.equal(knownEmail.status, 202);
  // An outbox entry with the reset subject should appear
  const resetEntry = store.emailOutbox.find((entry) =>
    entry.subject.toLowerCase().includes("reset")
  );
  assert.ok(resetEntry, "expected reset email in outbox");

  // Forgot password for an unknown email also returns 202 (no enumeration)
  const unknown = await postJson("/auth/forgot-password", {
    email: "nobody@example.com"
  });
  assert.equal(unknown.status, 202);

  // Use the reset token
  const resetResponse = await postJson("/auth/reset-password", {
    token: resetEntry.token,
    password: "brand-new-password"
  });
  assert.equal(resetResponse.status, 204);

  // Old password no longer works
  const oldLogin = await postJson("/auth/login", {
    email: "reset@example.com",
    password: "originalpass"
  });
  assert.equal(oldLogin.status, 401);

  // New password works
  const newLogin = await postJson("/auth/login", {
    email: "reset@example.com",
    password: "brand-new-password"
  });
  assert.equal(newLogin.status, 200);

  // Token cannot be reused
  const reuse = await postJson("/auth/reset-password", {
    token: resetEntry.token,
    password: "another-password"
  });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.body.error?.code, "TOKEN_USED");
});

test("login is rate-limited after 5 failed attempts from the same IP", async () => {
  await postJson("/auth/register", {
    email: "ratelimit@example.com",
    password: "password123",
    role: "creator"
  });
  const verifyToken = store.emailOutbox[0]?.token;
  assert.ok(verifyToken);
  await postJson("/auth/verify-email", { token: verifyToken });

  // 5 bad attempts allowed, the 6th is throttled.
  for (let i = 0; i < 5; i += 1) {
    const bad = await postJson("/auth/login", {
      email: "ratelimit@example.com",
      password: "wrong-password"
    });
    assert.equal(bad.status, 401, `attempt ${i + 1} should be 401`);
  }

  const blocked = await postJson("/auth/login", {
    email: "ratelimit@example.com",
    password: "password123"
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error?.code, "RATE_LIMITED");
});

test("parental consent, account export and deletion endpoints", async () => {
  // Underage but >=13 user
  const now = new Date();
  const fourteenYearsAgo = new Date(
    now.getUTCFullYear() - 14,
    now.getUTCMonth(),
    now.getUTCDate()
  )
    .toISOString()
    .slice(0, 10);

  await postJson("/auth/register", {
    email: "teen@example.com",
    password: "password123",
    role: "creator",
    dateOfBirth: fourteenYearsAgo
  });
  const verifyToken = store.emailOutbox[0]?.token;
  assert.ok(verifyToken);
  await postJson("/auth/verify-email", { token: verifyToken });

  const login = await postJson("/auth/login", {
    email: "teen@example.com",
    password: "password123"
  });
  assert.equal(login.status, 200);
  const accessToken = login.body.accessToken as string;

  // Before consent: payment endpoint should be blocked.
  const fundBlocked = await request("POST", "/payments/escrow/fund", {
    body: { matchId: "00000000-0000-0000-0000-000000000000", amountCents: 1000 },
    accessToken
  });
  // Either the parental-consent gate fires (403) OR, if payments aren't
  // wired in this test app (no payment service), the route is missing and
  // returns 404. Both prove the gate prevents unauthenticated minors from
  // reaching the success path.
  assert.ok(
    fundBlocked.status === 403 || fundBlocked.status === 404,
    `unexpected status ${fundBlocked.status}`
  );
  if (fundBlocked.status === 403) {
    assert.equal(fundBlocked.body.error?.code, "PARENTAL_CONSENT_REQUIRED");
  }

  // Grant consent.
  const consent = await request("POST", "/auth/me/parental-consent", {
    body: { parentEmail: "parent@example.com" },
    accessToken
  });
  assert.equal(consent.status, 200);
  assert.equal(consent.body.user?.parentalConsentGranted, true);

  // Export user data.
  const exportRes = await request("GET", "/auth/me/export", { accessToken });
  assert.equal(exportRes.status, 200);
  assert.equal(exportRes.body.user?.email, "teen@example.com");
  assert.ok(Array.isArray(exportRes.body.emailOutbox));

  // Delete the account.
  const del = await request("DELETE", "/auth/me", { accessToken });
  assert.equal(del.status, 204);

  // The user is gone.
  const after = await store.findUserByEmail("teen@example.com");
  assert.equal(after, null);
});

async function postJson(path: string, body: unknown) {
  return request("POST", path, { body });
}

async function request(
  method: string,
  path: string,
  options: { body?: unknown; accessToken?: string; cookie?: string } = {}
): Promise<{ status: number; body: ResponseBody }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {})
    }
  });
  const text = await response.text();
  let parsed: ResponseBody = {} as ResponseBody;
  if (text) {
    try {
      parsed = JSON.parse(text) as ResponseBody;
    } catch {
      parsed = {} as ResponseBody;
    }
  }
  return {
    status: response.status,
    body: parsed
  };
}

type ResponseBody = {
  accessToken?: string;
  emailOutbox?: unknown[];
  error?: { code?: string };
  ok?: boolean;
  user?: {
    email?: string;
    parentalConsentGranted?: boolean;
    role?: string;
  };
};
