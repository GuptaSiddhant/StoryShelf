/**
 * The portal's hop to a content host (ADR 0051, decision 5): in `subdomain` mode the portal never
 * serves uploaded bytes. A viewer who passed `publishedAccess` on the canonical path or the short
 * link is sent with a `302` to `<build-id>.<baseDomain>`. A public build goes straight there; a
 * private one goes through `/_x/<exchange-token>/`, which sets the host's own cookie.
 *
 * The answer carries a credential in its `Location`, so it is `no-store` and `no-referrer`, and only
 * a navigation gets it (decision 9). The target is built from the configured portal origin and base
 * domain, never from the request's `Host`, so the redirect cannot be steered elsewhere.
 */
import {
  contentOriginOf,
  hostingOriginsOfConfig,
  type HostingOrigins,
} from "@storyshelf/core/config";
import type { Build, Project } from "@storyshelf/core/schema";
import { storybookExchangePath } from "@storyshelf/core/utils";
import type { Context } from "hono";
import { getStore } from "../store.ts";
import { mintExchangeToken } from "./content-grants.ts";
import { isNavigation } from "./fetch-metadata.ts";
import type { PublishedAccess } from "./published-access.ts";
import { applySignedUrlHeaders, refuseToken } from "./published-files.ts";

/** A file path as URL path segments, each re-encoded (the path was decoded once, by `publishedRelativePath`). */
export function encodedRelativePath(rel: string): string {
  return rel
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * Where the redirect points: the content host itself for a public build, its `/_x/` exchange (with a
 * fresh token) for a private one; null when there is no secret to mint with.
 */
function contentLocation(
  origins: HostingOrigins,
  target: { project: Project; build: Build; access: PublishedAccess; rest: string },
): string | null {
  const { project, build, access, rest } = target;
  const host = contentOriginOf(origins, build.id);
  const path = encodedRelativePath(rest);
  if (access === "public") {
    return `${host}/${path}`;
  }
  const token = mintExchangeToken(project, build);
  return token === null ? null : `${host}${storybookExchangePath(token)}${path}`;
}

/**
 * The `302` to the build's content host. Path and query are kept (Storybook reads `?path=` and
 * `?id=`). Anything that is not a navigation, and any deployment without the credentials to mint,
 * gets the one identical 404.
 */
export function redirectToContentHost(
  c: Context,
  target: { project: Project; build: Build; access: PublishedAccess; rest: string },
): Response {
  const origins = hostingOriginsOfConfig(getStore().config);
  if (!origins || !isNavigation(c)) {
    return refuseToken(c, origins ? "not a navigation" : "no content hosts");
  }
  const location = contentLocation(origins, target);
  if (location === null) {
    return refuseToken(c, "no secret");
  }
  applySignedUrlHeaders(c);
  return c.redirect(`${location}${new URL(c.req.url).search}`, 302);
}
