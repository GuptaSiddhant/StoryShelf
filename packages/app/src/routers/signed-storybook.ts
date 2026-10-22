/**
 * Signed Storybook URLs (ADR 0007, decision 5): `GET /_s/<token>/<file>` serves one build's static
 * Storybook files to a remote browser, with no session. The HMAC token is the only credential; it
 * names one project and one build and expires. The file itself is served by the same handler and
 * access policy as the other published routes (`published-files.ts`, `published-access.ts`).
 * Nothing else lives under `/_s/`: no wrapper page, no API, no other build, no listing.
 */
import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import {
  STORYBOOK_TOKEN_PREFIX,
  storybookTokenPath,
  verifyStorybookToken,
} from "@storyshelf/core/utils";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { credentialKeys } from "../credential-keys.ts";
import { getStore } from "../store.ts";
import { publishedAccess } from "./published-access.ts";
import {
  publishedRelativePath,
  servePublishedFile,
  SIGNED_URL_HEADERS,
} from "./published-files.ts";

/** Register the signed-URL file route. */
export function registerSignedStorybook(app: ShelfRouter): void {
  app.get(`${STORYBOOK_TOKEN_PREFIX}:token/*`, async (c) => await serveSigned(c));
}

async function serveSigned(c: Context): Promise<Response> {
  const token = c.req.param("token") ?? "";
  const rel = publishedRelativePath(c.req.path, storybookTokenPath(token));
  if (!rel) {
    return refuse(c, "bad path");
  }
  return (await serveGranted(c, token, rel)) ?? refuse(c, "no such file");
}

/** The file the token grants as a response, or null (for the debug log only: why not). */
async function serveGranted(c: Context, token: string, rel: string): Promise<Response | null> {
  const { config, db } = getStore();
  const verified = verifyStorybookToken(token, credentialKeys(config));
  if (!verified.ok) {
    return refuse(c, verified.reason);
  }
  const { projectId, buildId } = verified.claims;
  const [project, build] = await Promise.all([
    new ProjectModel(db).get(projectId),
    new BuildModel(db).get(buildId),
  ]);
  const access = project && build ? await publishedAccess(build, project, verified.claims) : null;
  if (access !== "token") {
    return refuse(c, "unknown build");
  }
  return await servePublishedFile(c, { projectId, buildId, rel, access, cacheControl: "" });
}

/** The one answer for every refusal, so a caller cannot tell a bad signature from an expired token. */
function refuse(c: Context, reason: string): Response {
  getStore().logger.debug({ reason }, "signed storybook request refused");
  return c.text("Not found", 404, SIGNED_URL_HEADERS);
}
