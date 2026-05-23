import assert from "node:assert/strict";
import test from "node:test";
import { loadIntegrations } from "./registry.js";
import { LogEmailProvider, SendgridEmailProvider } from "./email-provider.js";
import { LocalDiskStorage, S3Storage } from "./media-storage.js";
import { StubOAuthProvider, GoogleOAuthProvider } from "./oauth-provider.js";
import { StubYouTubeClient, GoogleYouTubeClient } from "./social-stats.js";

test("registry uses dev stubs when no env vars are set", () => {
  const r = loadIntegrations({});
  assert.ok(r.email instanceof LogEmailProvider);
  assert.ok(r.storage instanceof LocalDiskStorage);
  assert.ok(r.youtube instanceof StubYouTubeClient);
  assert.equal(r.yookassa, null);
  assert.ok(r.googleOauth instanceof StubOAuthProvider);
});

test("registry activates production adapters when keys are set", () => {
  const r = loadIntegrations({
    SENDGRID_API_KEY: "k",
    S3_BUCKET: "b",
    S3_ACCESS_KEY_ID: "id",
    S3_SECRET_ACCESS_KEY: "secret",
    YOOKASSA_SHOP_ID: "shop",
    YOOKASSA_SECRET_KEY: "secret",
    YOUTUBE_API_KEY: "yt",
    GOOGLE_OAUTH_CLIENT_ID: "g",
    GOOGLE_OAUTH_CLIENT_SECRET: "gs"
  });
  assert.ok(r.email instanceof SendgridEmailProvider);
  assert.ok(r.storage instanceof S3Storage);
  assert.ok(r.yookassa !== null);
  assert.ok(r.youtube instanceof GoogleYouTubeClient);
  assert.ok(r.googleOauth instanceof GoogleOAuthProvider);
});
