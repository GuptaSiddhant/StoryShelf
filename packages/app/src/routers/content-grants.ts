/**
 * Minting and reading the credentials of a content host (ADR 0051, decision 5). A leaf module on
 * purpose: the portal's redirect and the content host's router share it, nothing else does.
 *
 * - The **exchange token** (`exchange`, 60 s) rides in the URL of the portal's redirect to
 *   `<build-id>.<baseDomain>/_x/<token>/` and is accepted only there, for that build.
 * - The **grant cookie** holds a sealed `cookie` token (one hour) minted by the exchange. It is never
 *   the exchange token, and it is re-checked against the host's own build on every request.
 */
import type { Build, Project } from "@storyshelf/core/schema";
import {
  signStorybookToken,
  STORYBOOK_COOKIE_TTL,
  STORYBOOK_GRANT_COOKIE,
  verifyStorybookToken,
  type StorybookTokenClaims,
} from "@storyshelf/core/utils";
import { getStore } from "../store.ts";

/** An exchange token for `build`, or null when the server has no secret to sign it with. */
export function mintExchangeToken(project: Project, build: Build): string | null {
  const { secret } = getStore().config;
  return secret
    ? signStorybookToken({
        secret,
        projectId: project.id,
        buildId: build.id,
        purpose: "exchange",
      })
    : null;
}

/** The `Set-Cookie` line a content host answers a valid exchange with, or null with no secret. */
export function grantCookieLine(project: Project, build: Build): string | null {
  const { secret } = getStore().config;
  if (!secret) {
    return null;
  }
  const value = signStorybookToken({
    secret,
    projectId: project.id,
    buildId: build.id,
    purpose: "cookie",
  });
  return `${STORYBOOK_GRANT_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${String(STORYBOOK_COOKIE_TTL)}`;
}

/** The first value of cookie `name` in a `Cookie` header, or undefined. */
function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

/**
 * The verified claims of the request's grant cookie, or null when it is missing, forged, expired,
 * sealed under another secret, or not a `cookie` token. The caller still compares the build.
 */
export function readGrantCookie(cookieHeader: string | undefined): StorybookTokenClaims | null {
  const { secret } = getStore().config;
  const value = cookieValue(cookieHeader, STORYBOOK_GRANT_COOKIE);
  if (!secret || !value) {
    return null;
  }
  const verified = verifyStorybookToken(value, secret, "cookie");
  return verified.ok ? verified.claims : null;
}
