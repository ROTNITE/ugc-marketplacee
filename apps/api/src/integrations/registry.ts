import { logger } from "../observability/logger.js";
import {
  LogEmailProvider,
  SendgridEmailProvider,
  type EmailProvider
} from "./email-provider.js";
import { FcmPushProvider, LogPushProvider, type PushProvider } from "./push-provider.js";
import { LocalDiskStorage, S3Storage, type MediaStorage } from "./media-storage.js";
import { HttpYooKassaProvider, type YooKassaProvider } from "./yookassa-provider.js";
import {
  GoogleOAuthProvider,
  StubOAuthProvider,
  VkOAuthProvider,
  type OAuthProvider
} from "./oauth-provider.js";
import {
  GoogleYouTubeClient,
  HttpTikTokClient,
  HttpVkClient,
  StubTikTokClient,
  StubVkClient,
  StubYouTubeClient,
  type TikTokClient,
  type VkClient,
  type YouTubeClient
} from "./social-stats.js";

export type IntegrationRegistry = {
  email: EmailProvider;
  push: PushProvider;
  storage: MediaStorage;
  youtube: YouTubeClient;
  tiktok: TikTokClient;
  vk: VkClient;
  yookassa: YooKassaProvider | null;
  googleOauth: OAuthProvider;
  vkOauth: OAuthProvider;
};

export function loadIntegrations(env = process.env): IntegrationRegistry {
  const email: EmailProvider = env.SENDGRID_API_KEY
    ? new SendgridEmailProvider(
        env.SENDGRID_API_KEY,
        env.SENDGRID_FROM_EMAIL ?? "noreply@ugc-marketplace.local"
      )
    : new LogEmailProvider();

  const push: PushProvider = env.FCM_SERVER_KEY
    ? new FcmPushProvider(env.FCM_SERVER_KEY)
    : new LogPushProvider();

  const storage: MediaStorage =
    env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? new S3Storage(
          env.S3_BUCKET,
          env.S3_REGION ?? "us-east-1",
          env.S3_ACCESS_KEY_ID,
          env.S3_SECRET_ACCESS_KEY,
          env.S3_ENDPOINT
        )
      : new LocalDiskStorage();

  const yookassa: YooKassaProvider | null =
    env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY
      ? new HttpYooKassaProvider(env.YOOKASSA_SHOP_ID, env.YOOKASSA_SECRET_KEY)
      : null;

  const youtube: YouTubeClient = env.YOUTUBE_API_KEY
    ? new GoogleYouTubeClient(env.YOUTUBE_API_KEY)
    : new StubYouTubeClient();
  const tiktok: TikTokClient = env.TIKTOK_ACCESS_TOKEN
    ? new HttpTikTokClient(env.TIKTOK_ACCESS_TOKEN)
    : new StubTikTokClient();
  const vk: VkClient = env.VK_ACCESS_TOKEN
    ? new HttpVkClient(env.VK_ACCESS_TOKEN)
    : new StubVkClient();

  const googleOauth: OAuthProvider =
    env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET
      ? new GoogleOAuthProvider(
          env.GOOGLE_OAUTH_CLIENT_ID,
          env.GOOGLE_OAUTH_CLIENT_SECRET
        )
      : new StubOAuthProvider("google");
  const vkOauth: OAuthProvider =
    env.VK_OAUTH_CLIENT_ID && env.VK_OAUTH_CLIENT_SECRET
      ? new VkOAuthProvider(env.VK_OAUTH_CLIENT_ID, env.VK_OAUTH_CLIENT_SECRET)
      : new StubOAuthProvider("vk");

  logger.info(
    {
      email: email.constructor.name,
      push: push.constructor.name,
      storage: storage.constructor.name,
      yookassa: yookassa?.constructor.name ?? "disabled",
      youtube: youtube.constructor.name,
      tiktok: tiktok.constructor.name,
      vk: vk.constructor.name,
      googleOauth: googleOauth.constructor.name,
      vkOauth: vkOauth.constructor.name
    },
    "integrations loaded"
  );

  return {
    email,
    push,
    storage,
    youtube,
    tiktok,
    vk,
    yookassa,
    googleOauth,
    vkOauth
  };
}
