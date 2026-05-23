import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import test, { beforeEach } from "node:test";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashOpaqueToken, signAccessToken } from "./security.js";
import { MemoryAuthStore } from "./memory-store.test-helper.js";
import { _resetRateLimitStoreForTests } from "./rate-limit.js";
import type { PublicUser } from "./types.js";

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
    throw new Error("Expected test server address.");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("register creates an unverified user with hashed password and rejects duplicate email", async () => {
  const response = await post("/auth/register", {
    email: "Creator@Example.com",
    password: "password123",
    role: "creator"
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.user.email, "creator@example.com");
  assert.equal(response.body.user.emailVerified, false);
  assert.equal(response.body.user.role, "creator");
  assert.equal(store.emailOutbox.length, 1);

  const user = await store.findUserByEmail("creator@example.com");
  assert.ok(user);
  assert.notEqual(user.passwordHash, "password123");

  const duplicate = await post("/auth/register", {
    email: "creator@example.com",
    password: "password123",
    role: "creator"
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, "DUPLICATE_EMAIL");
});

test("verify email accepts a token once and rejects reused, invalid, and expired tokens", async () => {
  await register("verify@example.com");
  const token = store.emailOutbox[0]?.token;
  assert.ok(token);

  const verified = await post("/auth/verify-email", { token });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.emailVerified, true);

  const reused = await post("/auth/verify-email", { token });
  assert.equal(reused.status, 400);
  assert.equal(reused.body.error.code, "TOKEN_USED");

  const invalid = await post("/auth/verify-email", { token: "not-a-real-token" });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_TOKEN");

  await register("expired@example.com");
  const expiredToken = store.emailOutbox[0]?.token;
  assert.ok(expiredToken);
  const record = await store.findVerificationTokenByHash(hashOpaqueToken(expiredToken));
  assert.ok(record);
  store.verificationTokens.set(record.id, {
    ...record,
    expiresAt: new Date(Date.now() - 1000)
  });

  const expired = await post("/auth/verify-email", { token: expiredToken });
  assert.equal(expired.status, 400);
  assert.equal(expired.body.error.code, "TOKEN_EXPIRED");
});

test("resend verification is non-enumerating and creates another outbox item for unverified users", async () => {
  await register("resend@example.com");
  assert.equal(store.emailOutbox.length, 1);

  const response = await post("/auth/resend-verification", {
    email: "resend@example.com"
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.ok, true);
  assert.equal(store.emailOutbox.length, 2);

  const missing = await post("/auth/resend-verification", {
    email: "missing@example.com"
  });
  assert.equal(missing.status, 202);
  assert.equal(missing.body.ok, true);
});

test("login rejects wrong passwords and unverified users, then returns JWT and refresh cookie", async () => {
  await register("login@example.com");

  const unverified = await post("/auth/login", {
    email: "login@example.com",
    password: "password123"
  });
  assert.equal(unverified.status, 403);
  assert.equal(unverified.body.error.code, "EMAIL_NOT_VERIFIED");

  await verifyLatestEmail();

  const wrongPassword = await post("/auth/login", {
    email: "login@example.com",
    password: "wrong-password"
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongPassword.body.error.code, "INVALID_CREDENTIALS");

  const login = await post("/auth/login", {
    email: "login@example.com",
    password: "password123"
  });
  assert.equal(login.status, 200);
  assert.equal(typeof login.body.accessToken, "string");
  assert.equal(login.body.user.email, "login@example.com");
  assert.match(login.setCookie ?? "", /ugc_refresh=/);
  assert.match(login.setCookie ?? "", /HttpOnly/);
});

test("refresh rotates the cookie and rejects replayed refresh tokens", async () => {
  await registerAndVerify("refresh@example.com");
  const login = await loginUser("refresh@example.com");
  const oldCookie = getCookie(login.setCookie);

  const refreshed = await post("/auth/refresh", undefined, oldCookie);
  assert.equal(refreshed.status, 200);
  assert.notEqual(getCookie(refreshed.setCookie), oldCookie);

  const replay = await post("/auth/refresh", undefined, oldCookie);
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error.code, "INVALID_REFRESH_TOKEN");
});

test("logout revokes the active refresh token", async () => {
  await registerAndVerify("logout@example.com");
  const login = await loginUser("logout@example.com");
  const cookie = getCookie(login.setCookie);

  const logout = await post("/auth/logout", undefined, cookie);
  assert.equal(logout.status, 204);

  const refresh = await post("/auth/refresh", undefined, cookie);
  assert.equal(refresh.status, 401);
  assert.equal(refresh.body.error.code, "INVALID_REFRESH_TOKEN");
});

test("role switch persists the role and returns an updated access token claim", async () => {
  await registerAndVerify("role@example.com");
  const login = await loginUser("role@example.com");

  const switched = await patch(
    "/auth/me/role",
    { role: "brand" },
    login.body.accessToken as string
  );

  assert.equal(switched.status, 200);
  assert.equal(switched.body.user.role, "brand");
  assert.equal(typeof switched.body.accessToken, "string");

  const user = await store.findUserByEmail("role@example.com");
  assert.equal(user?.role, "brand");

  const me = await get("/auth/me", switched.body.accessToken as string);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, "brand");

  const invalid = await patch(
    "/auth/me/role",
    { role: "admin" },
    login.body.accessToken as string
  );
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_PAYLOAD");
});

test("protected routes reject missing and expired access tokens", async () => {
  const missing = await get("/auth/me");
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error.code, "UNAUTHORIZED");

  const expiredToken = await signAccessToken(
    {
      id: "00000000-0000-0000-0000-000000000000",
      email: "expired@example.com",
      emailVerified: true,
      role: "creator",
      status: "active",
      isMinor: false,
      parentalConsentGranted: true
    } satisfies PublicUser,
    { jwtSecret: config.jwtSecret, accessTokenTtlSeconds: -1 }
  );

  const expired = await get("/auth/me", expiredToken);
  assert.equal(expired.status, 401);
  assert.equal(expired.body.error.code, "UNAUTHORIZED");
});

async function register(email: string) {
  return post("/auth/register", {
    email,
    password: "password123",
    role: "creator"
  });
}

async function registerAndVerify(email: string) {
  await register(email);
  await verifyLatestEmail();
}

async function verifyLatestEmail() {
  const token = store.emailOutbox[0]?.token;
  assert.ok(token);
  const response = await post("/auth/verify-email", { token });
  assert.equal(response.status, 200);
}

async function loginUser(email: string) {
  const response = await post("/auth/login", {
    email,
    password: "password123"
  });
  assert.equal(response.status, 200);
  return response;
}

async function get(path: string, accessToken?: string) {
  return request("GET", path, undefined, undefined, accessToken);
}

async function post(path: string, body?: unknown, cookie?: string) {
  return request("POST", path, body, cookie);
}

async function patch(path: string, body: unknown, accessToken: string) {
  return request("PATCH", path, body, undefined, accessToken);
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
  accessToken?: string
): Promise<{
  status: number;
  body: TestResponseBody;
  setCookie: string | null;
}> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    }
  });
  const text = await response.text();

  return {
    status: response.status,
    body: text ? JSON.parse(text) : {},
    setCookie: response.headers.get("set-cookie")
  };
}

function getCookie(setCookie: string | null): string {
  assert.ok(setCookie);
  return setCookie.split(";")[0] ?? "";
}

type TestResponseBody = {
  accessToken?: string;
  error: {
    code?: string;
  };
  ok?: boolean;
  user: {
    email?: string;
    emailVerified?: boolean;
    role?: string;
  };
};
