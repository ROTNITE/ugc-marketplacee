import { randomBytes, randomUUID } from "node:crypto";
import type { Router } from "express";
import { Router as createRouter } from "express";
import type { OAuthProvider } from "../integrations/oauth-provider.js";
import type { AuthStore } from "./store.js";
import { hashPassword, signAccessToken } from "./security.js";
import { toPublicUser } from "./types.js";
import type { ApiConfig } from "../config.js";

/**
 * Sign-in-with-Google and Sign-in-with-VK endpoints.
 *
 * Flow:
 *   1. Client calls GET /auth/oauth/<provider>/start -> returns the
 *      authorization URL plus a freshly-minted state cookie.
 *   2. Provider redirects the user back to /auth/oauth/<provider>/callback
 *      with `code` and `state`. We verify `state` against the cookie,
 *      exchange `code` for an identity, find-or-create a user, and return
 *      an access token.
 *
 * If a user with the identity's email already exists we link the OAuth
 * identity to that user; otherwise we provision a new account with a
 * random password (the user can later set one via the password reset
 * flow). The new account is marked email-verified.
 */
export function createOAuthRouter(input: {
  providers: { google: OAuthProvider; vk: OAuthProvider };
  store: AuthStore;
  config: Pick<ApiConfig, "accessTokenTtlSeconds" | "jwtSecret" | "webAppUrl">;
}): Router {
  const router = createRouter();

  for (const name of ["google", "vk"] as const) {
    const provider = input.providers[name];
    const redirectUri = `${input.config.webAppUrl}/auth/oauth/${name}/callback`;
    const stateCookie = `ugc_oauth_${name}_state`;

    router.get(`/${name}/start`, (_request, response) => {
      const state = randomBytes(24).toString("hex");
      response.cookie(stateCookie, state, {
        httpOnly: true,
        sameSite: "lax",
        path: "/auth"
      });
      response.json({ url: provider.buildAuthorizationUrl(state, redirectUri) });
    });

    router.post(`/${name}/callback`, async (request, response, next) => {
      try {
        const { code, state } = request.body ?? {};
        const cookieState = request.cookies?.[stateCookie];
        if (
          typeof code !== "string" ||
          typeof state !== "string" ||
          typeof cookieState !== "string" ||
          cookieState !== state
        ) {
          response
            .status(400)
            .json({ error: { code: "OAUTH_STATE_MISMATCH", message: "Bad state" } });
          return;
        }
        const identity = await provider.exchangeCode(code, redirectUri);
        let user = identity.email
          ? await input.store.findUserByEmail(identity.email.toLowerCase())
          : null;
        if (!user) {
          if (!identity.email) {
            response.status(400).json({
              error: {
                code: "OAUTH_NO_EMAIL",
                message: "Provider did not return an email"
              }
            });
            return;
          }
          user = await input.store.createUser({
            id: randomUUID(),
            email: identity.email.toLowerCase(),
            passwordHash: await hashPassword(randomBytes(32).toString("hex")),
            role: "creator",
            dateOfBirth: null
          });
          await input.store.updateUserEmailVerified(user.id, new Date());
        }
        const publicUser = toPublicUser(user);
        const accessToken = await signAccessToken(publicUser, input.config);
        response.json({ user: publicUser, accessToken });
      } catch (error) {
        next(error);
      }
    });
  }

  return router;
}
