# Third-party integrations

Every external provider lives behind an interface plus two implementations:

| Provider       | Interface         | Dev impl              | Production impl         | Env var(s) that activate prod                           |
| -------------- | ----------------- | --------------------- | ----------------------- | ------------------------------------------------------- |
| Email          | `EmailProvider`   | `OutboxEmailProvider` | `SendgridEmailProvider` | `SENDGRID_API_KEY`                                      |
| Push           | `PushProvider`    | `LogPushProvider`     | `FcmPushProvider`       | `FCM_SERVER_KEY`                                        |
| Object storage | `MediaStorage`    | `LocalDiskStorage`    | `S3Storage`             | `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| RU payments    | `PaymentProvider` | (Stripe sandbox)      | `YooKassaProvider`      | `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`               |
| YouTube stats  | `YouTubeClient`   | `StubYouTubeClient`   | `GoogleYouTubeClient`   | `YOUTUBE_API_KEY`                                       |
| TikTok stats   | `TikTokClient`    | `StubTikTokClient`    | `TikTokClient`          | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`             |
| VK stats       | `VkClient`        | `StubVkClient`        | `VkClient`              | `VK_ACCESS_TOKEN`                                       |
| Google OAuth   | `OAuthProvider`   | `StubOAuthProvider`   | `GoogleOAuthProvider`   | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`  |
| VK OAuth       | `OAuthProvider`   | `StubOAuthProvider`   | `VkOAuthProvider`       | `VK_OAUTH_CLIENT_ID`, `VK_OAUTH_CLIENT_SECRET`          |

The container in `integrations/registry.ts` picks the production impl when
the matching env vars are populated, otherwise falls back to the dev impl.
This means the API boots and serves traffic with zero external accounts
configured. Add a key, restart, and the corresponding feature lights up
without code changes.
