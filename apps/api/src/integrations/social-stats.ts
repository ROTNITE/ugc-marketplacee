import { logger } from "../observability/logger.js";

export type SocialStats = {
  platform: "youtube" | "tiktok" | "vk";
  handle: string;
  followers: number | null;
  /** Verified at this timestamp (null if not yet verified). */
  verifiedAt: Date | null;
};

export type YouTubeClient = {
  getChannelStats(handle: string): Promise<SocialStats>;
};
export type TikTokClient = {
  getUserStats(handle: string): Promise<SocialStats>;
};
export type VkClient = {
  getUserStats(handle: string): Promise<SocialStats>;
};

/**
 * Dev stubs: return null follower counts so the API doesn't lie about
 * audience size when no real key is configured.
 */
export class StubYouTubeClient implements YouTubeClient {
  async getChannelStats(handle: string): Promise<SocialStats> {
    return { platform: "youtube", handle, followers: null, verifiedAt: null };
  }
}
export class StubTikTokClient implements TikTokClient {
  async getUserStats(handle: string): Promise<SocialStats> {
    return { platform: "tiktok", handle, followers: null, verifiedAt: null };
  }
}
export class StubVkClient implements VkClient {
  async getUserStats(handle: string): Promise<SocialStats> {
    return { platform: "vk", handle, followers: null, verifiedAt: null };
  }
}

/**
 * Real YouTube Data API v3 - channels.list?part=statistics.
 * Activates when YOUTUBE_API_KEY is set.
 *
 * For a public channel handle like `@somehandle` you first need to resolve
 * it to a channel ID. The implementation below accepts either a raw
 * channel ID (UC...) or a search by handle as a fallback.
 */
export class GoogleYouTubeClient implements YouTubeClient {
  constructor(private readonly apiKey: string) {}

  async getChannelStats(handle: string): Promise<SocialStats> {
    let channelId = handle.startsWith("UC") ? handle : null;
    if (!channelId) {
      channelId = await this.resolveByHandle(handle);
    }
    if (!channelId) {
      return { platform: "youtube", handle, followers: null, verifiedAt: null };
    }
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", channelId);
    url.searchParams.set("key", this.apiKey);
    const response = await fetch(url);
    if (!response.ok) {
      logger.warn({ status: response.status }, "youtube channels.list failed");
      return { platform: "youtube", handle, followers: null, verifiedAt: null };
    }
    const data = (await response.json()) as {
      items?: Array<{ statistics?: { subscriberCount?: string } }>;
    };
    const followers = Number.parseInt(
      data.items?.[0]?.statistics?.subscriberCount ?? "",
      10
    );
    return {
      platform: "youtube",
      handle,
      followers: Number.isFinite(followers) ? followers : null,
      verifiedAt: new Date()
    };
  }

  private async resolveByHandle(handle: string): Promise<string | null> {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "channel");
    url.searchParams.set("q", handle.replace(/^@/, ""));
    url.searchParams.set("maxResults", "1");
    url.searchParams.set("key", this.apiKey);
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = (await response.json()) as {
      items?: Array<{ snippet?: { channelId?: string } }>;
    };
    return data.items?.[0]?.snippet?.channelId ?? null;
  }
}

/**
 * VK API users.get / groups.getById. Activates when VK_ACCESS_TOKEN set.
 *
 * The VK API takes a user/group screen_name and returns followers_count.
 */
export class HttpVkClient implements VkClient {
  constructor(
    private readonly accessToken: string,
    private readonly apiVersion = "5.199"
  ) {}

  async getUserStats(handle: string): Promise<SocialStats> {
    const url = new URL("https://api.vk.com/method/users.get");
    url.searchParams.set("user_ids", handle.replace(/^@/, ""));
    url.searchParams.set("fields", "followers_count");
    url.searchParams.set("access_token", this.accessToken);
    url.searchParams.set("v", this.apiVersion);
    const response = await fetch(url);
    if (!response.ok) {
      return { platform: "vk", handle, followers: null, verifiedAt: null };
    }
    const data = (await response.json()) as {
      response?: Array<{ followers_count?: number }>;
    };
    const followers = data.response?.[0]?.followers_count ?? null;
    return {
      platform: "vk",
      handle,
      followers: typeof followers === "number" ? followers : null,
      verifiedAt: new Date()
    };
  }
}

/**
 * TikTok stats need an OAuth client-credentials flow. We don't implement the
 * full flow here (it requires per-user OAuth approval). The HttpTikTokClient
 * is a placeholder that surfaces the cached follower count if the caller
 * provides an already-acquired access token via env.
 */
export class HttpTikTokClient implements TikTokClient {
  constructor(private readonly accessToken: string) {}

  async getUserStats(handle: string): Promise<SocialStats> {
    const response = await fetch(
      `https://open.tiktokapis.com/v2/user/info/?fields=follower_count,display_name`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` }
      }
    );
    if (!response.ok) {
      return { platform: "tiktok", handle, followers: null, verifiedAt: null };
    }
    const data = (await response.json()) as {
      data?: { user?: { follower_count?: number } };
    };
    return {
      platform: "tiktok",
      handle,
      followers: data.data?.user?.follower_count ?? null,
      verifiedAt: new Date()
    };
  }
}
