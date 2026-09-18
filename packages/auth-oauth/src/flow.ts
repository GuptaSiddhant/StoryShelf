import type { AuthUser } from "@storyshelf/core/adapter/auth";
import { extractGroups, roleForGroups } from "./groups.ts";
import type { OAuthAuthOptions, OidcEndpoints } from "./types.ts";

interface TokenResponse {
  access_token?: string;
}

interface UserInfoResponse {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
}

export function buildLoginUrl(
  endpoints: OidcEndpoints,
  options: OAuthAuthOptions,
  scopes: string[],
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUrl,
    response_type: "code",
    scope: scopes.join(" "),
    state,
  });
  return `${endpoints.authorizationEndpoint}?${params.toString()}`;
}

export async function exchangeCode(
  endpoints: OidcEndpoints,
  options: OAuthAuthOptions,
  code: string,
): Promise<string | null> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: options.clientId,
    client_secret: options.clientSecret,
    redirect_uri: options.redirectUrl,
  });
  const response = await fetch(endpoints.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as TokenResponse;
  return data.access_token ?? null;
}

export async function fetchUserInfo(
  endpoints: OidcEndpoints,
  options: OAuthAuthOptions,
  accessToken: string,
): Promise<AuthUser | null> {
  const response = await fetch(endpoints.userinfoEndpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    return null;
  }
  const info = (await response.json()) as UserInfoResponse;
  if (!info.sub) {
    return null;
  }
  const groups = extractGroups(info, options.groupClaims ?? ["groups", "cognito:groups"]);
  return {
    id: info.sub,
    email: info.email ?? "",
    name: info.name ?? info.email ?? info.sub,
    avatarUrl: info.picture,
    role: roleForGroups(groups, options),
    groups,
  };
}
