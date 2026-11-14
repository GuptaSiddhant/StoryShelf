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
import { catalogOf, getStore } from "../store.ts";
import {
  DEVELOPER_ROLES,
  announceBuildStatus,
  attachLabels,
  buildLabelsSchema,
} from "./builds.handlers.ts";
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
    entryIds: z.array(z.string()).max(100_000),
    idempotencyKey: z.string().min(1).max(191),
    labels: buildLabelsSchema.optional(),
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
    "Records a commit that changed no story as a `skipped` build repeating the outcome of `sourceBuildId`: no upload, capture or snapshots. Eligibility is checked again in the same transaction as the insert: `409` when the source is no longer the newest approved build of the branch (or a skipped one's approved source), is on another branch, the project runs Storybook tests, or `entryIds` differ from the source build's catalog (a story was added, renamed or deleted). A repeated `idempotencyKey` returns the build it already created (`200`). `labels` are validated and attached as on normal build creation. It raises `build:skipped` and asks for the build's state on its git channels. `testing` class; 404 unless the instance enables skipped builds.",
  path: "/api/v1/projects/{slug}/builds/skipped",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/json": { schema: skippedBuildSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: skippedBuildCreatedSchema } },
      description: "The build an earlier request with the same `idempotencyKey` created",
    },
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
    const { build, created } = await recordSkipped(project, c.req.valid("json"));
    const urls = createUrlBuilder("/", contentHostSuffix(getStore().config));
    return c.json({ build, buildUrl: urls.build(project.slug, build.id) }, created ? 201 : 200);
  });
}

/**
 * The skipped build for this request: the one a repeated `idempotencyKey` already created
 * (`created: false`), or a new one after the catalog check. Either way the follow-up steps run, so
 * a retry finishes whatever a failure after the insert left undone (ADR 0044, decision 4).
 */
async function recordSkipped(
  project: Project,
  input: z.infer<typeof skippedBuildSchema>,
): Promise<{ build: Build; created: boolean }> {
  const existing = await new BuildModel(getStore().db).findByIdempotencyKey(
    project.id,
    input.idempotencyKey,
  );
  if (existing) {
    await finishSkipped(existing, input);
    return { build: existing, created: false };
  }
  await assertSameCatalog(project, input);
  const { build, raced } = await createChecked(project, input);
  await finishSkipped(build, input);
  return { build, created: !raced };
}

/**
 * The steps after the insert: attach the labels (an upsert, so a repeat adds none twice) and
 * announce the build, which queues one notify job per channel and build. All are idempotent.
 */
async function finishSkipped(
  build: Build,
  input: z.infer<typeof skippedBuildSchema>,
): Promise<void> {
  if (input.labels && input.labels.length > 0) {
    await attachLabels(getStore().db, build.projectId, build.id, input.labels);
  }
  await announceBuildStatus(build.id, "skipped");
  await requestBuildState(build.id);
}

/**
 * 409 unless `entryIds` are exactly the source build's catalog (ADR 0044, decision 4): an added,
 * renamed or deleted story always uploads. A published build is write-once, so reading the source
 * outside the insert's transaction cannot race a change to it.
 */
async function assertSameCatalog(
  project: Project,
  input: z.infer<typeof skippedBuildSchema>,
): Promise<void> {
  const builds = new BuildModel(getStore().db);
  const found = await builds.get(input.sourceBuildId);
  const source = found === null ? null : await builds.skipSourceOf(found);
  if (source === null || source.projectId !== project.id) return; // createChecked answers 409
  const catalog = await catalogOf()
    .load(project.id, source.id)
    .catch(() => null);
  const have = new Set(catalog?.entries.map((entry) => entry.id));
  const sent = new Set(input.entryIds);
  const same = catalog !== null && have.size === sent.size && [...sent].every((id) => have.has(id));
  if (!same) {
    throw new HTTPException(409, {
      message: "The stories differ from the source build's: upload the Storybook",
    });
  }
}

/** Insert the skipped build, turning a refused source into the `409` the CLI answers by uploading. */
async function createChecked(
  project: Project,
  input: z.infer<typeof skippedBuildSchema>,
): Promise<{ build: Build; raced: boolean }> {
  try {
    const build = await new BuildModel(getStore().db).createSkippedIfEligible({
      projectId: project.id,
      gitSha: input.gitSha,
      gitBranch: input.gitBranch,
      isDefault: input.gitBranch === project.gitDefaultBranch,
      sourceBuildId: input.sourceBuildId,
      changedFiles: input.changedFiles,
      idempotencyKey: input.idempotencyKey,
      ...(input.message === undefined ? {} : { message: input.message }),
      ...(input.author === undefined ? {} : { author: input.author }),
    });
    return { build, raced: false };
  } catch (error) {
    // A concurrent request with the same key may have won first (its commit can also be what
    // makes this one refused): the recorded build is the answer, ahead of any refusal.
    const raced = await new BuildModel(getStore().db).findByIdempotencyKey(
      project.id,
      input.idempotencyKey,
    );
    if (raced) return { build: raced, raced: true };
    if (error instanceof SkipSourceRefused) {
      throw new HTTPException(409, { message: error.message });
    }
    throw error;
  }
}
