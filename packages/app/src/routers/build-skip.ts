/**
 * The skip endpoints (ADR 0044, decisions 3 and 4): a hint for which build a commit that changed no
 * story may repeat, and the creation of that skipped build. Both are class `testing` (404 without
 * `options.testing`) and answer 404 too unless `options.skippedBuilds` is on, so a release can ship
 * the readers of the `skipped` status before any server writes one (ADR 0053).
 */
import { createRoute, z } from "@hono/zod-openapi";
import { contentHostSuffix } from "@storyshelf/core/config";
import { BuildModel, SkipSourceRefused } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { requestBuildState } from "../git-status.ts";
import { getStore } from "../store.ts";
import { DEVELOPER_ROLES, announceBuildStatus } from "./builds.handlers.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { buildSchema, errorSchema, notFound, unauthorized } from "./schemas.ts";

/** Message of the 404 both routes answer while `options.skippedBuilds` is off. */
export const SKIPPED_BUILDS_DISABLED_MESSAGE = "Skipped builds are not enabled on this instance.";

const skipSourceSchema = z
  .object({ sourceBuildId: z.string(), sha: z.string() })
  .nullable()
  .openapi("SkipSource");

const skippedBuildSchema = z
  .object({
    gitSha: z.string().min(1),
    gitBranch: z.string().min(1),
    sourceBuildId: z.string().min(1),
    changedFiles: z.array(z.string()).max(20_000),
    message: z.string().optional(),
    author: z.object({ email: z.string().optional(), name: z.string().optional() }).optional(),
  })
  .openapi("SkippedBuildCreate");

const skippedBuildCreatedSchema = z
  .object({ build: buildSchema, buildUrl: z.string() })
  .openapi("SkippedBuildCreated");

const skipSourceRoute = createRoute({
  method: "get",
  tags: ["Builds"],
  summary: "Find the build a commit may skip from",
  description:
    "A hint for `--skip-unchanged`: the real build the newest build on `branch` (other than commit `sha`) repeats, or null. Only an `approved` build qualifies, or a skipped build whose source is still `approved`; a newer build that is open, rejected, failed or cancelled answers null. `testing` class; 404 unless the instance enables skipped builds. Creation re-checks, so this is never a promise.",
  path: "/api/v1/projects/{slug}/builds/skip-source",
  request: {
    params: z.object({ slug: z.string() }),
    query: z.object({ branch: z.string().min(1), sha: z.string().min(1) }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: skipSourceSchema } },
      description: "The source build and its commit, or null when the commit must upload normally",
    },
    ...notFound,
    ...unauthorized,
  },
});

const createSkippedRoute = createRoute({
  method: "post",
  tags: ["Builds"],
  summary: "Create a skipped build",
  description:
    "Records a commit that changed no story as a `skipped` build repeating the outcome of `sourceBuildId`: no upload, capture or snapshots. Eligibility is checked again in the same transaction as the insert: `409` when the source is no longer the newest approved build of the branch (or a skipped one's approved source), is on another branch, or the project runs Storybook tests. It raises `build:skipped` and asks for the build's state on its git channels. `testing` class; 404 unless the instance enables skipped builds.",
  path: "/api/v1/projects/{slug}/builds/skipped",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/json": { schema: skippedBuildSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: skippedBuildCreatedSchema } },
      description: "The skipped build and the URL of its page",
    },
    409: {
      content: { "application/json": { schema: errorSchema } },
      description: "The source is not eligible: upload the Storybook normally",
    },
    ...notFound,
    ...unauthorized,
  },
});

/** 404 unless the instance accepts skipped builds. */
function assertSkippedBuildsEnabled(): void {
  if (getStore().skippedBuilds !== true) {
    throw new HTTPException(404, { message: SKIPPED_BUILDS_DISABLED_MESSAGE });
  }
}

/** A project that runs Storybook tests never skips: a failing test would be hidden (decision 3). */
function assertSkippable(project: Project): void {
  if (project.runTests === true) {
    throw new HTTPException(409, {
      message: "This project runs Storybook tests on every build, so no build is skipped",
    });
  }
}

/** Register `GET …/builds/skip-source` and `POST …/builds/skipped` (`testing` class). */
export function registerBuildSkip(app: ShelfRouter): void {
  app.openapi(skipSourceRoute, async (c) => {
    assertSkippedBuildsEnabled();
    const project = await resolveAuthorizedProject(
      c,
      c.req.valid("param").slug,
      ...DEVELOPER_ROLES,
    );
    const { branch, sha } = c.req.valid("query");
    if (project.runTests === true) return c.json(null, 200);
    const source = await new BuildModel(getStore().db).findSkipSource(project.id, branch, sha);
    return c.json(source ? { sourceBuildId: source.id, sha: source.gitSha } : null, 200);
  });

  app.openapi(createSkippedRoute, async (c) => {
    assertSkippedBuildsEnabled();
    const project = await resolveAuthorizedProject(
      c,
      c.req.valid("param").slug,
      ...DEVELOPER_ROLES,
    );
    assertSkippable(project);
    const input = c.req.valid("json");
    const build = await createChecked(project, input);
    await announceBuildStatus(build.id, "skipped");
    await requestBuildState(build.id);
    const urls = createUrlBuilder("/", contentHostSuffix(getStore().config));
    return c.json({ build, buildUrl: urls.build(project.slug, build.id) }, 201);
  });
}

/** Insert the skipped build, turning a refused source into the `409` the CLI answers by uploading. */
async function createChecked(
  project: Project,
  input: z.infer<typeof skippedBuildSchema>,
): Promise<Build> {
  try {
    return await new BuildModel(getStore().db).createSkippedIfEligible({
      projectId: project.id,
      gitSha: input.gitSha,
      gitBranch: input.gitBranch,
      isDefault: input.gitBranch === project.gitDefaultBranch,
      sourceBuildId: input.sourceBuildId,
      changedFiles: input.changedFiles,
      ...(input.message === undefined ? {} : { message: input.message }),
      ...(input.author === undefined ? {} : { author: input.author }),
    });
  } catch (error) {
    if (error instanceof SkipSourceRefused) {
      throw new HTTPException(409, { message: error.message });
    }
    throw error;
  }
}
