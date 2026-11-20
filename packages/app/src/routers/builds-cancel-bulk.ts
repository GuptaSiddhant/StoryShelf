import { createRoute, z } from "@hono/zod-openapi";
import { BuildModel } from "@storyshelf/core/models";
import type { BuildSummary } from "@storyshelf/core/models";
import { CANCELLABLE_BUILD_STATUSES, selectOlderUnfinished } from "@storyshelf/core/types";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { cancelBuild } from "./build-cancel.ts";
import { DEVELOPER_ROLES } from "./builds.handlers.ts";
import { flashHx } from "./flash.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { hxRefresh } from "./htmx.ts";
import { notFound, unauthorized } from "./schemas.ts";

/** Builds cancelled at once, so a large backlog never holds one long run of writes. */
const CANCEL_BATCH_SIZE = 10;

const bulkCancelBodySchema = z
  .object({
    branch: z.string().min(1).optional(),
    keepNewest: z.number().int().min(0).default(1),
    dryRun: z.boolean().default(false),
  })
  .openapi("BulkCancelRequest");

const bulkCancelResultSchema = z
  .object({
    cancelled: z.array(z.string()),
    count: z.number().int(),
    dryRun: z.boolean(),
  })
  .openapi("BulkCancelResult");

const bulkCancelRoute = createRoute({
  method: "post",
  tags: ["Builds"],
  summary: "Cancel older unfinished builds",
  description:
    "Cancels the unfinished builds (pending, capturing or comparing) of the project, or of one `branch`, keeping the `keepNewest` newest unfinished builds of each branch (default 1; 0 cancels them all). Builds in any other status are left alone. Each build is cancelled as `POST …/builds/{buildId}/cancel` does, in batches: its jobs end, it ends `cancelled`, `build:cancelled` is raised and its git statuses are requested. A build that reaches a verdict meanwhile is skipped. With `dryRun` nothing changes and `cancelled` lists the builds that would be. `testing` class; same roles as a single cancel.",
  path: "/api/v1/projects/{slug}/builds/cancel",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/json": { schema: bulkCancelBodySchema } }, required: false },
  },
  responses: {
    200: {
      content: { "application/json": { schema: bulkCancelResultSchema } },
      description:
        "The IDs of the cancelled builds (or those a dry run would cancel) and their count",
    },
    ...notFound,
    ...unauthorized,
  },
});

async function listUnfinished(projectId: string, branch?: string): Promise<BuildSummary[]> {
  const builds = new BuildModel(getStore().db);
  const filter = branch === undefined ? {} : { branch };
  const lists = await Promise.all(
    CANCELLABLE_BUILD_STATUSES.map(
      async (status) => await builds.listSummary(projectId, { ...filter, status }),
    ),
  );
  return lists.flat();
}

/** Cancel one build the single-cancel way; false when it reached a verdict in the meantime. */
async function cancelOne(buildId: string): Promise<boolean> {
  try {
    await cancelBuild(buildId);
    return true;
  } catch (err) {
    if (err instanceof HTTPException && err.status === 409) {
      return false;
    }
    throw err;
  }
}

/** Cancel the builds a batch at a time; returns the IDs that were cancelled. */
async function cancelInBatches(ids: readonly string[]): Promise<string[]> {
  const cancelled: string[] = [];
  for (let start = 0; start < ids.length; start += CANCEL_BATCH_SIZE) {
    const batch = ids.slice(start, start + CANCEL_BATCH_SIZE);
    // oxlint-disable-next-line no-await-in-loop -- batches run one after another on purpose
    const outcomes = await Promise.all(batch.map(async (id) => await cancelOne(id)));
    cancelled.push(...batch.filter((_, index) => outcomes[index]));
  }
  return cancelled;
}

/** What to cancel: the API body and the page form both reduce to this. */
export interface CancelOlderOptions {
  branch?: string | undefined;
  keepNewest?: number;
  dryRun?: boolean;
}

/**
 * Cancel the older unfinished builds of a project (or list them with `dryRun`) and return their
 * IDs. The one implementation behind the API route and the builds page's form.
 */
export async function cancelOlderBuilds(
  projectId: string,
  options: CancelOlderOptions = {},
): Promise<string[]> {
  const { branch, keepNewest = 1, dryRun = false } = options;
  const unfinished = await listUnfinished(projectId, branch);
  const ids = selectOlderUnfinished(unfinished, keepNewest).map((build) => build.id);
  return dryRun ? ids : await cancelInBatches(ids);
}

/** Register `POST …/builds/cancel` (`testing` class). */
export function registerBuildsCancelBulk(app: ShelfRouter): void {
  app.openapi(bulkCancelRoute, async (c) => {
    const project = await resolveAuthorizedProject(
      c,
      c.req.valid("param").slug,
      ...DEVELOPER_ROLES,
    );
    // The body is optional: without one the validator hands back no defaults.
    const body = c.req.valid("json") as Partial<z.infer<typeof bulkCancelBodySchema>> | undefined;
    const { dryRun = false } = body ?? {};
    const cancelled = await cancelOlderBuilds(project.id, body ?? {});
    if (!dryRun) {
      hxRefresh(c);
      flashHx(c, `${cancelled.length} builds cancelled`);
    }
    return c.json({ cancelled, count: cancelled.length, dryRun }, 200);
  });
}
