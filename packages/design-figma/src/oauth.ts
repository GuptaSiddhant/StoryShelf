/** Figma OAuth 2 (authorization-code grant): consent URL, code exchange and refresh. */
import type { OAuthClient, OAuthTokens } from "@storyshelf/core/adapter/oauth";
import { httpJson } from "@storyshelf/core/utils";

/** Operator-registered Figma OAuth app (Figma → Settings → OAuth apps). */
export interface FigmaOAuthOptions {
  clientId: string;
  clientSecret: string;
}

const AUTHORIZE_URL = "https://www.figma.com/oauth";
const TOKEN_URL = "https://api.figma.com/v1/oauth/token";
const REFRESH_URL = "https://api.figma.com/v1/oauth/refresh";
/** Read-only: file content (names, versions, renders). */
const SCOPE = "file_content:read";
/** Figma issues 90-day access tokens; used when a response omits `expires_in`. */
const DEFAULT_EXPIRES_S = 90 * 24 * 60 * 60;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/** OAuth app credentials from `FIGMA_CLIENT_ID` / `FIGMA_CLIENT_SECRET`, or undefined when either is unset. */
export function figmaOAuthFromEnv(
  env: Record<string, string | undefined> = process.env,
): FigmaOAuthOptions | undefined {
  const clientId = env["FIGMA_CLIENT_ID"];
  const clientSecret = env["FIGMA_CLIENT_SECRET"];
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

/** Figma's {@link OAuthClient} for one registered OAuth app. */
export function createFigmaOAuth(options: FigmaOAuthOptions): OAuthClient {
  const basic = `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`;
  const post = async (
    url: string,
    form: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<OAuthTokens> => {
    const response = await httpJson<TokenResponse>(url, {
      method: "POST",
      headers: { Authorization: basic },
      form,
      retries: 1,
      ...(signal ? { signal } : {}),
    });
    return toTokens(response);
  };
  return {
    authorizeUrl: ({ state, redirectUri }) => {
      const params = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirectUri,
        scope: SCOPE,
        state,
        response_type: "code",
      });
      return `${AUTHORIZE_URL}?${params.toString()}`;
    },
    exchangeCode: async ({ code, redirectUri, signal }) =>
      await post(
        TOKEN_URL,
        { redirect_uri: redirectUri, code, grant_type: "authorization_code" },
        signal,
      ),
    refresh: async ({ refreshToken, signal }) =>
      await post(REFRESH_URL, { refresh_token: refreshToken }, signal),
  };
}

function toTokens(response: TokenResponse): OAuthTokens {
  const seconds = response.expires_in ?? DEFAULT_EXPIRES_S;
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? null,
    expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
  };
}
