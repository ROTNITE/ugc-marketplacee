import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import test, { beforeEach } from "node:test";
import { TOTP, Secret } from "otpauth";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { MemoryAuthStore } from "./memory-store.test-helper.js";
import { _resetRateLimitStoreForTests } from "./rate-limit.js";

const config = loadConfig({
  API_HOST: "127.0.0.1",
  API_PORT: "0",
  COOKIE_SAME_SITE: "lax",
  COOKIE_SECURE: "false",
  DATABASE_URL: "postgresql://unused",
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
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("addr");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

test("2FA full lifecycle: start, confirm, login challenge, disable", async () => {
  await register("totp@example.com");
  const verifyToken = store.emailOutbox[0]?.token;
  assert.ok(verifyToken);
  await postJson("/auth/verify-email", { token: verifyToken });
  const login = await postJson("/auth/login", {
    email: "totp@example.com",
    password: "password123"
  });
  const access = login.body.accessToken as string;

  // Start enrollment
  const start = await request("POST", "/auth/me/2fa/start", { accessToken: access });
  assert.equal(start.status, 200);
  const secret = start.body.secret as string;
  assert.ok(secret);
  assert.ok((start.body.otpauthUri as string).startsWith("otpauth://"));

  // Confirm with a correct code
  const code = generateCode(secret);
  const confirm = await request("POST", "/auth/me/2fa/confirm", {
    accessToken: access,
    body: { code }
  });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.user?.totpEnabled, true);

  // Future logins now require a code
  const noCode = await postJson("/auth/login", {
    email: "totp@example.com",
    password: "password123"
  });
  assert.equal(noCode.status, 401);
  assert.equal(noCode.body.error?.code, "TOTP_REQUIRED");

  const withCode = await postJson("/auth/login", {
    email: "totp@example.com",
    password: "password123",
    totp: generateCode(secret)
  });
  assert.equal(withCode.status, 200);

  // Disable 2FA
  const disable = await request("POST", "/auth/me/2fa/disable", {
    accessToken: withCode.body.accessToken as string,
    body: { code: generateCode(secret) }
  });
  assert.equal(disable.status, 200);
  assert.equal(disable.body.user?.totpEnabled, false);
});

function generateCode(secret: string): string {
  return new TOTP({
    issuer: "UGC Marketplace",
    secret: Secret.fromBase32(secret)
  }).generate();
}

async function register(email: string) {
  return postJson("/auth/register", { email, password: "password123", role: "creator" });
}
async function postJson(path: string, body: unknown) {
  return request("POST", path, { body });
}
async function request(
  method: string,
  path: string,
  options: { body?: unknown; accessToken?: string } = {}
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {})
    }
  });
  const text = await response.text();
  let parsed: ResponseBody = {} as ResponseBody;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      /* tolerated */
    }
  }
  return { status: response.status, body: parsed };
}

type ResponseBody = {
  accessToken?: string;
  secret?: string;
  otpauthUri?: string;
  error?: { code?: string };
  user?: { totpEnabled?: boolean };
};
