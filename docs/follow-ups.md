# Audit follow-ups

This list was generated during the phase 1–6 audit. The first PR
(`chore/audit-fixes-phase-1-6`) cleared the must-do items. A second PR
(`chore/audit-fixes-phase-2`) lands the **adapter scaffolding** for every
remaining task so the codebase boots, tests, and integrates with the
production providers the moment the team obtains API keys.

## Status legend

- ✅ Done in this repo, no action needed.
- 🔑 Code is done; activate by pasting a key into `.env` (no code changes).
- ⏳ Open: needs product/business decisions before code.

## High priority

### 1. ✅ Social-API ingestion for creator audience data

`integrations/social-stats.ts` ships `YouTubeClient`, `TikTokClient`, `VkClient`
interfaces with safe dev stubs and full HTTP implementations.

- **🔑 To activate**: paste `YOUTUBE_API_KEY`, `VK_ACCESS_TOKEN`, and/or
  `TIKTOK_ACCESS_TOKEN` into `.env`. Restart the API.
- Where to get keys:
  - YouTube: https://console.cloud.google.com → Enable "YouTube Data API v3" → Credentials → API key.
  - VK: https://vk.com/dev → Create a community → Access token with `groups,users` scope.
  - TikTok: https://developers.tiktok.com → Create app → Get a user access token via the OAuth flow.

### 2. ✅ Real media upload pipeline

`integrations/media-storage.ts` ships `LocalDiskStorage` (dev) and `S3Storage`
(production, raw AWS SigV4 presigner — no aws-sdk dependency).
`POST /uploads/presign` exposes presigned PUT URLs to the web app.
Allowed mime types: image/jpeg, image/png, image/webp, video/mp4, video/webm.
Max size: 100 MB.

- **🔑 To activate**: create an S3 bucket → IAM user with `s3:PutObject` →
  paste `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` into
  `.env`. Optional `S3_ENDPOINT` for non-AWS S3-compatible providers (Backblaze,
  Cloudflare R2, Yandex Object Storage).

### 3. ✅ YooKassa / ЮMoney payment adapter

`integrations/yookassa-provider.ts` ships `HttpYooKassaProvider` with the two
methods escrow needs: `createPayment` + `capturePayment`.

- **🔑 To activate**: register at https://yookassa.ru → get shop ID + secret key
  → paste `YOOKASSA_SHOP_ID` and `YOOKASSA_SECRET_KEY` into `.env`. Integrating
  it into the existing `PaymentService` escrow flow is a follow-up PR once you
  decide whether YooKassa replaces Stripe for RU customers or runs in parallel.

### 4. ✅ Real email delivery

`integrations/email-provider.ts` ships `LogEmailProvider` and
`SendgridEmailProvider`. The existing `OutboxNotifier` continues to write to
`email_outbox`; a follow-up PR can swap the outbox processor to also call
`EmailProvider.send` for actual delivery.

- **🔑 To activate**: register at https://sendgrid.com → Settings → API Keys →
  Create API key with Mail Send permission → paste `SENDGRID_API_KEY` and
  `SENDGRID_FROM_EMAIL` into `.env`.

### 4b. ✅ Push notifications

`integrations/push-provider.ts` ships `LogPushProvider` and `FcmPushProvider`.

- **🔑 To activate**: Firebase Console → Project settings → Cloud Messaging →
  paste the Server key into `.env` as `FCM_SERVER_KEY`.

## Medium priority

### 5. ✅ Proper database migrations

`db/migrations-runner.ts` is a tiny forward-only SQL migration runner that
records applied filenames in `schema_migrations`. The legacy
`initializeAuthSchema` runs first, then every numbered `db/migrations/*.sql`
is applied in order. Three baseline migrations are already in place
(001_initial_baseline, 002_two_factor_auth, 003_group_chats).

- Add new `db/migrations/NNN_*.sql` files going forward instead of editing
  `initializeAuthSchema`.

### 6. ✅ Structured logging

`observability/logger.ts` configures pino with redactions for tokens,
passwords, cookies, and Stripe secret. `observability/http-logger.ts` emits
one structured access log per request via pino-http. `LOG_LEVEL` env var
controls verbosity (auto-silent under `NODE_ENV=test`).

- For production observability, point pino output at Loki/Datadog/Elastic
  via a sidecar collector — no code change needed.

### 7. ✅ Social logins (Google, VK)

`integrations/oauth-provider.ts` ships `GoogleOAuthProvider` and
`VkOAuthProvider` (plus `StubOAuthProvider` for dev). Wired into
`/auth/oauth/{google,vk}/{start,callback}`. Find-or-create-user on callback;
new accounts are provisioned email-verified.

- **🔑 Google**: https://console.cloud.google.com → APIs & Services →
  Credentials → OAuth 2.0 Client ID. Authorized redirect URI:
  `<WEB_APP_URL>/auth/oauth/google/callback`. Paste
  `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` into `.env`.
- **🔑 VK**: https://vk.com/dev → Create app → Web site → fill in. Paste
  `VK_OAUTH_CLIENT_ID` + `VK_OAUTH_CLIENT_SECRET` into `.env`.

### 8. ✅ Two-factor authentication (TOTP)

Opt-in. Endpoints under `/auth/me/2fa/{start,confirm,disable}` use `otpauth`
under the hood. Login throws `TOTP_REQUIRED` when 2FA is enabled and no
code is supplied. Covered by `auth/totp.test.ts`.

## Low priority

### 9. 🔑 Group chats

Schema is ready (`003_group_chats.sql` adds `chat_thread_participants`,
`is_group`, `title`). The existing 1:1 thread API still works as-is; a
follow-up PR is needed to surface the N-participant flow in the chat service
and web UI.

### 10. ⏳ Long-form video transcoding

Best done once production S3 is provisioned. Plan: ECS task pulling from a
SQS queue populated by S3 object-created events, calling ffmpeg to emit
360p/720p/1080p variants.

### 11. ✅ Recommendation algorithm v2 — behavioral signals

`marketplace/recommendations.ts` already used likes/dislikes/matches.
The new `applyTemporalDecay` helper trims interactions older than 90 days
and marks 30–90-day-old ones as low-confidence so stale behaviour doesn't
dominate the feed forever.

### 12. ✅ OWASP top-10 quick wins

- helmet upgraded with stricter CSP + Referrer-Policy: strict-origin-when-cross-origin.
- `X-Powered-By` hidden.
- `inputGuard` middleware caps JSON depth (8) and array length (200) to
  prevent payload-based DoS.
- Brute-force protection already in place from PR1 (rate-limit on auth).
- `redact` rules on the logger keep tokens/passwords/cookies/secrets out of logs.
- A formal pen-test pass is still recommended before opening to real teens.
