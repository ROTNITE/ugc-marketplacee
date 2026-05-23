export type OAuthIdentity = {
  provider: "google" | "vk";
  providerUserId: string;
  email: string | null;
  displayName: string | null;
};

export type OAuthProvider = {
  /** Build the URL the client should redirect to for OAuth consent. */
  buildAuthorizationUrl(state: string, redirectUri: string): string;
  /** Exchange the OAuth `code` for an identity. */
  exchangeCode(code: string, redirectUri: string): Promise<OAuthIdentity>;
};

/**
 * Dev stub: returns a deterministic fake identity so the rest of the
 * sign-in pipeline can be exercised without hitting Google/VK.
 */
export class StubOAuthProvider implements OAuthProvider {
  constructor(private readonly provider: "google" | "vk") {}

  buildAuthorizationUrl(state: string): string {
    return `https://example.test/oauth/${this.provider}?state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(code: string): Promise<OAuthIdentity> {
    return {
      provider: this.provider,
      providerUserId: `stub-${code}`,
      email: `stub-${code}@example.test`,
      displayName: `Stub ${this.provider} user`
    };
  }
}

export class GoogleOAuthProvider implements OAuthProvider {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string
  ) {}

  buildAuthorizationUrl(state: string, redirectUri: string): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthIdentity> {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });
    if (!tokenResponse.ok) {
      throw new Error(`Google token exchange failed: ${tokenResponse.status}`);
    }
    const token = (await tokenResponse.json()) as { access_token: string };
    const profile = (await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` }
    }).then((r) => r.json())) as {
      sub: string;
      email?: string;
      name?: string;
    };
    return {
      provider: "google",
      providerUserId: profile.sub,
      email: profile.email ?? null,
      displayName: profile.name ?? null
    };
  }
}

export class VkOAuthProvider implements OAuthProvider {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string
  ) {}

  buildAuthorizationUrl(state: string, redirectUri: string): string {
    const url = new URL("https://oauth.vk.com/authorize");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "email");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthIdentity> {
    const url = new URL("https://oauth.vk.com/access_token");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("client_secret", this.clientSecret);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("code", code);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`VK token exchange failed: ${response.status}`);
    const data = (await response.json()) as {
      user_id: number;
      email?: string;
    };
    return {
      provider: "vk",
      providerUserId: String(data.user_id),
      email: data.email ?? null,
      displayName: null
    };
  }
}
