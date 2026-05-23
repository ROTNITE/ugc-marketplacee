# Audit follow-ups

Issues found during the phase 1–6 audit that are intentionally **not** included
in this PR because they each deserve their own focused change. Convert each
section into a GitHub issue when you triage the next sprint.

## High priority

### 1. Social-API ingestion for creator audience data

Right now `audienceSize` on `profiles` is user-entered and unverified, so a
creator can claim 100k subscribers without proof. We need server-side fetchers
that hit the official APIs and refresh stats periodically.

- YouTube Data API v3 — channel.statistics.subscriberCount.
- TikTok display API — basic profile info, follower count.
- VK API — `users.get` + `groups.getById`.
- Store last-verified timestamp on the profile and surface it to brands.

### 2. Real media upload pipeline

Both campaign briefs and chat attachments currently accept a `url` string but
do not host the file. Brands have to host elsewhere, which is fragile and
unsafe for moderation.

- POST `/uploads/presign` returning an S3 (or compatible) presigned URL.
- Server-side mime/size validation before the URL is issued.
- Hook into moderation: ClamAV + image/video safety check before the media
  becomes visible.

### 3. YooKassa / ЮMoney payment adapter

Stripe is wired in but is impractical for the RU market. Add a payment
adapter interface alongside `StripeService` so the existing escrow flow can
route through either provider.

### 4. Real email + push delivery

`OutboxNotifier` only writes to the dev outbox. Add adapters for:

- Transactional email: SendGrid or Mailgun (chat messages, matches,
  password reset, verification).
- Push: Firebase Cloud Messaging for the planned mobile clients.

Both should be plugged in behind the existing `Notifier` interface so
business code doesn't change.

## Medium priority

### 5. Proper database migrations

`initializeAuthSchema` is fine for the prototype but mixes 20+ tables and
relies on `ADD COLUMN IF NOT EXISTS`. Move to drizzle-kit or node-pg-migrate
before any production deploy.

### 6. Structured logging and observability

Replace every `console.log` / `console.error` with `pino` and wire it to a
sink (Loki, Datadog, etc.). Add `/metrics` for Prometheus. Add Sentry to the
web app.

### 7. Social logins (Google, VK)

Optional in the original plan, but a big conversion booster for the target
audience. Plug Passport.js or oauth4webapi into `AuthService`.

### 8. Two-factor authentication

TOTP-based 2FA, opt-in. Store `totp_secret` on the user. Block payments and
account-deletion behind a fresh 2FA challenge.

## Low priority / nice to have

### 9. Group chats

Brands running team campaigns may want a thread with multiple creators.
Requires schema change (`chat_thread_participants`).

### 10. Long-form video transcoding

Once uploads are in, run FFmpeg / AWS Elastic Transcoder to generate
multi-resolution streams for smooth playback.

### 11. Recommendation algorithm v2

Today's recommendation service is a content-based filter. Add behavioral
signals (swipe history, completed campaigns) and consider a simple
collaborative filter.

### 12. Group privacy review

Run an OWASP top-10 pass and a privacy review (152-FZ + COPPA-style) before
opening the platform to real teens.

## How to apply the CI workflow update

The `chore/audit-fixes-phase-1-6` PR ships a patched `.github/workflows/ci.yml`
in `ci-update.patch` instead of as a direct file change, because the Personal
Access Token used by the agent did not have the `workflow` scope. Apply it
locally before merging:

```bash
git checkout chore/audit-fixes-phase-1-6
git apply ci-update.patch
git add .github/workflows/ci.yml
git rm ci-update.patch
git commit -m "ci: add postgres service container"
git push
```

Or, if you prefer, regenerate the token with the `workflow` scope and let the
agent push directly.
