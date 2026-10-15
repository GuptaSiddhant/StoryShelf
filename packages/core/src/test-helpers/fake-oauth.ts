/** A scriptable in-memory OAuth client for connection and flow tests. */
import type { OAuthClient, OAuthTokens } from "../adapters/oauth.ts";

/** Behavior and call log of a {@link makeFakeOAuth} client. */
export interface FakeOAuth {
  client: OAuthClient;
  /** Make the next `refresh` calls reject. */
  failRefresh: boolean;
  /** Make `exchangeCode` reject. */
  failExchange: boolean;
  /** Seconds until the tokens it issues expire (null = never). */
  expiresInS: number | null;
  exchanged: { code: string; redirectUri: string }[];
  refreshed: string[];
}

/** Create a fake OAuth client issuing `access-N` / `refresh-N` tokens. */
export function makeFakeOAuth(): FakeOAuth {
  let counter = 0;
  const fake: FakeOAuth = {
    client: undefined as unknown as OAuthClient,
    failRefresh: false,
    failExchange: false,
    expiresInS: 3600,
    exchanged: [],
    refreshed: [],
  };
  const issue = (): OAuthTokens => {
    counter += 1;
    return {
      accessToken: `access-${counter}`,
      refreshToken: `refresh-${counter}`,
      expiresAt:
        fake.expiresInS === null
          ? null
          : new Date(Date.now() + fake.expiresInS * 1000).toISOString(),
    };
  };
  fake.client = {
    authorizeUrl: ({ state, redirectUri }) =>
      `https://oauth.test/authorize?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async ({ code, redirectUri }) => {
      fake.exchanged.push({ code, redirectUri });
      if (fake.failExchange) throw new Error("exchange failed");
      return await Promise.resolve(issue());
    },
    refresh: async ({ refreshToken }) => {
      fake.refreshed.push(refreshToken);
      await Promise.resolve();
      if (fake.failRefresh) throw new Error("refresh failed");
      return { ...issue(), refreshToken: null };
    },
  };
  return fake;
}
