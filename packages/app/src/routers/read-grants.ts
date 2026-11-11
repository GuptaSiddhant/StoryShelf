/**
 * Read grants (ADR 0051, decision 4): `GET /_r/<token>/<file>` serves one build's uploaded files to a
 * viewer's browser that cannot send a cookie, a sandboxed frame on an opaque origin. The `read` token
 * is the credential: it names one project and one build, lives an hour at most, is signed with its own
 * key and verifies against the current secret only, so a rotation ends every grant.
 *
 * A grant is minted only by {@link redirectToReadGrant} (a viewer who passed `publishedAccess` on the
 * canonical path, so renewal re-checks permission) and by `previewBaseOf` (a preview frame). Nothing
 * else lives under `/_r/`: no page, no API, no other build, no listing. Every answer is sandboxed,
 * `private, no-store` and `no-referrer`, and every refusal is the one identical 404.
 */
import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import {
  STORYBOOK_READ_PREFIX,
  storybookReadPath,
  verifyStorybookToken,
} from "@storyshelf/core/utils";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { publishedAccess } from "./published-access.ts";
import {
  publishedRelativePath,
  refuseToken,
  servePublishedFile,
  SIGNED_URL_HEADERS,
} from "./published-files.ts";
import { mintReadGrant } from "./read-grant-token.ts";

/** Register the read-grant file route. */
export function registerReadGrants(app: ShelfRouter): void {
  app.get(`${STORYBOOK_READ_PREFIX}:token/*`, async (c) => await serveRead(c));
}

async function serveRead(c: Context): Promise<Response> {
  const token = c.req.param("token") ?? "";
  const rel = publishedRelativePath(c.req.path, storybookReadPath(token));
  if (rel === null) {
    return refuseToken(c, "bad path");
  }
  return (await serveGrant(c, token, rel)) ?? refuseToken(c, "no such file");
}

/** The file the grant opens as a response, or null (for the debug log only: why not). */
async function serveGrant(c: Context, token: string, rel: string): Promise<Response | null> {
  const { config, db } = getStore();
  const verified = verifyStorybookToken(token, config.secret ?? "", "read");
  if (!verified.ok) {
    return refuseToken(c, verified.reason);
  }
  const { projectId, buildId } = verified.claims;
  const [project, build] = await Promise.all([
    new ProjectModel(db).get(projectId),
    new BuildModel(db).get(buildId),
  ]);
  const access = project && build ? await publishedAccess(build, project, verified.claims) : null;
  if (access !== "token") {
    return refuseToken(c, "unknown build");
  }
  return await servePublishedFile(c, {
    projectId,
    buildId,
    rel: rel === "" ? "index.html" : rel,
    access,
    family: "read",
    freshness: "immutable", // ignored: a grant's answer takes `signedCacheControl`, which is no-store
    grant: verified.claims,
  });
}

/**
 * The `302` that sends a viewer who passed `publishedAccess` to the build's file under a fresh read
 * grant (`sandboxed` mode, a private build). The file path is kept, re-encoded segment by segment,
 * and so is the query string (Storybook reads `?path=` and `?id=`). The answer carries a credential
 * in its `Location`, so it is `no-store` and `no-referrer`. With no secret there is nothing to
 * mint: boot refuses that, and the answer here is the identical 404.
 */
export function redirectToReadGrant(
  c: Context,
  project: Project,
  build: Build,
  rel: string,
): Response {
  const token = mintReadGrant(project, build);
  if (token === null) {
    return refuseToken(c, "no secret");
  }
  const path = rel
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const { search } = new URL(c.req.url);
  for (const [name, value] of Object.entries(SIGNED_URL_HEADERS)) {
    c.header(name, value);
  }
  return c.redirect(`${storybookReadPath(token)}${path}${search}`, 302);
}
