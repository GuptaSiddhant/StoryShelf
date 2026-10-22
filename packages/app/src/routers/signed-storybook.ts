/**
 * Signed Storybook URLs (ADR 0007, decision 5): `GET /s/<token>/<file>` serves one build's static
 * Storybook files to a remote browser, with no session. The HMAC token is the only credential; it
 * names one project and one build and expires. Nothing else lives under `/s/`: no wrapper page, no
 * API, no other build, no listing.
 */
import { readPublishedFile } from "@storyshelf/core/capture";
import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import { isSafeSegment, mimeFor, verifyStorybookToken } from "@storyshelf/core/utils";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";

/** Headers every answer carries: a token URL must not be cached, indexed or leaked by `Referer`. */
const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
} as const;

/** Register the signed-URL file route. */
export function registerSignedStorybook(app: ShelfRouter): void {
  app.get("/s/:token/*", async (c) => await serveSigned(c));
}

async function serveSigned(c: Context): Promise<Response> {
  const token = c.req.param("token") ?? "";
  const rel = relativePath(c.req.path, token);
  const file = rel === null ? "bad path" : await readSigned(token, rel);
  if (typeof file === "string" || rel === null) {
    return refuse(c, typeof file === "string" ? file : "bad path");
  }
  return c.body(new Uint8Array(file), 200, { ...PRIVATE_HEADERS, "content-type": mimeFor(rel) });
}

/** The file the token grants, or the reason it does not (for the debug log only). */
async function readSigned(token: string, rel: string): Promise<Buffer | string> {
  const { config, db, storage } = getStore();
  const keys = [config.secret, config.previousSecret].filter((key) => key !== undefined);
  const verified = verifyStorybookToken(token, keys);
  if (!verified.ok) {
    return verified.reason;
  }
  const { projectId, buildId } = verified.claims;
  const [project, build] = await Promise.all([
    new ProjectModel(db).get(projectId),
    new BuildModel(db).get(buildId),
  ]);
  if (!project || !build || build.projectId !== project.id) {
    return "unknown build";
  }
  return (await readPublishedFile(storage, project.id, build.id, rel)) ?? "no such file";
}

/**
 * The file path after `/s/<token>/`, decoded once, or null when it is empty or could leave the
 * build: empty, `.` or `..` segments, backslashes and NUL are all refused.
 */
function relativePath(path: string, token: string): string | null {
  const base = `/s/${token}/`;
  if (!path.startsWith(base)) {
    return null;
  }
  let rest: string;
  try {
    rest = decodeURIComponent(path.slice(base.length));
  } catch {
    return null;
  }
  const safe = rest
    .split("/")
    .every(
      (segment) =>
        segment !== "" && segment !== "." && !segment.includes("\0") && isSafeSegment(segment),
    );
  return safe ? rest : null;
}

/** The one answer for every refusal, so a caller cannot tell a bad signature from an expired token. */
function refuse(c: Context, reason: string): Response {
  getStore().logger.debug({ reason }, "signed storybook request refused");
  return c.text("Not found", 404, PRIVATE_HEADERS);
}
