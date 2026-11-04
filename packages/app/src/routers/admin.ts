/* oxlint-disable typescript/promise-function-async -- admin helpers are async by design */
import { createRoute, z } from "@hono/zod-openapi";
import type { BuildReferenceLifecycle, RetentionPause } from "@storyshelf/core/adapter/database";
import { ProjectModel } from "@storyshelf/core/models";
import { Retention } from "@storyshelf/core/retention";
import type { ShelfRouter } from "../app-types.ts";
import { reencryptWithCurrent } from "../credentials.ts";
import { notifySystem } from "../notify.ts";
import { getStore } from "../store.ts";
import { requireSiteAdmin } from "./helpers.ts";
import {
  errorSchema,
  forbidden as forbiddenResponse,
  purgeInputSchema,
  purgeSchema,
} from "./schemas.ts";
const purgeRoute = createRoute({
  method: "post",
  tags: ["Admin"],
  summary: "Run the retention purge",
  path: "/api/v1/admin/purge",
  request: { body: { content: { "application/json": { schema: purgeInputSchema } } } },
  responses: {
    200: {
      content: { "application/json": { schema: purgeSchema } },
      description: "Retention purge run",
    },
    503: {
      content: { "application/json": { schema: errorSchema } },
      description: "Testing retention requires atomic build lifecycle support",
    },
    ...forbiddenResponse,
  },
});

const reencryptSchema = z.object({
  reencrypted: z.number().int(),
  failed: z.number().int(),
  unreadable: z.number().int(),
});

const reencryptRoute = createRoute({
  method: "post",
  path: "/api/v1/admin/credentials/reencrypt",
  tags: ["Admin"],
  summary: "Re-encrypt stored credentials with the current secret",
  responses: {
    200: {
      content: { "application/json": { schema: reencryptSchema } },
      description: "Credentials re-encrypted with the current secret",
    },
    409: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "No previousSecret configured",
    },
    ...forbiddenResponse,
  },
});

/** Register the site-admin endpoints: retention purge and credential re-encryption. */
export function registerAdmin(app: ShelfRouter): void {
  app.openapi(reencryptRoute, async (c) => {
    requireSiteAdmin(c);
    const { db, config } = getStore();
    if (!config.previousSecret) {
      return c.json({ error: "No previousSecret is configured; nothing to re-encrypt" }, 409);
    }
    const result = await reencryptWithCurrent(db, config);
    return c.json(
      {
        reencrypted: result.reencrypted,
        failed: result.failed,
        unreadable: result.unreadable.length,
      },
      200,
    );
  });

  app.openapi(purgeRoute, async (c) => {
    requireSiteAdmin(c);
    const pass = startPurgePass();
    if (pass.refusal) return c.json({ message: pass.refusal }, 503);
    const body = c.req.valid("json");
    const ttlDays = body.ttlDays ?? getStore().config.purgeTtlDays ?? 30;
    const builds = await purgeBuilds(ttlDays, pass.lifecycle);
    const { removedBuilds } = builds;
    const branch = await purgeBranches();
    await notifySystem("sys:purge-completed", {
      removedBuilds,
      removedBranches: branch.removedBranches,
      removedBaselines: branch.removedBaselines,
      ttlDays,
    });
    return c.json(
      {
        removedBuilds,
        removedBranches: branch.removedBranches,
        removedBaselines: branch.removedBaselines,
        // Present with the lifecycle capability: builds a baseline still protects, and builds an
        // earlier unfinished run had claimed that this run finished.
        ...(builds.protectedBuilds === undefined
          ? {}
          : { protected: builds.protectedBuilds, resumed: builds.resumedBuilds ?? 0 }),
      },
      200,
    );
  });
}

/**
 * Start a purge pass: read the lifecycle capability once, and decide from that one read whether the
 * pass is refused. The capability is then handed to every deletion of the pass; it is never read
 * again, so one that is cleared meanwhile cannot make the pass unfenced (ADR 0039).
 *
 * Without atomic reference admission and tombstones, deletion in a testing deployment can race a
 * baseline promotion. A database that withheld the capability for a data problem refuses too, with
 * or without `testing`: the unfenced path would delete builds a baseline still names.
 */
function startPurgePass(): { lifecycle: BuildReferenceLifecycle | undefined; refusal?: string } {
  const { testing, db } = getStore();
  const lifecycle = db.buildReferenceLifecycle;
  if (lifecycle || !(testing || db.retentionPause)) return { lifecycle };
  return { lifecycle, refusal: unavailableMessage(db.retentionPause) };
}

/** Why a testing deployment refuses to purge: no capability, and whether the database paused it. */
function unavailableMessage(pause: RetentionPause | undefined): string {
  const base =
    "Build purge is unavailable for this testing deployment until its database supports safe baseline retention. Builds are retained";
  return pause
    ? `${base}: retention is paused because baseline ${pause.baselineId} has an invalid source build ${pause.buildId}. See the System page.`
    : `${base}; contact your administrator.`;
}

/** Counts summed over the projects; the protected and resumed counts exist with the capability. */
interface PurgeTotals {
  removedBuilds: number;
  protectedBuilds?: number;
  resumedBuilds?: number;
}

// oxlint-disable-next-line typescript/promise-function-async
async function purgeBuilds(
  ttlDays: number,
  lifecycle: BuildReferenceLifecycle | undefined,
): Promise<PurgeTotals> {
  const projects = await new ProjectModel(getStore().db).list();
  const retention = new Retention(
    getStore().db,
    getStore().storage,
    {
      builds: getStore().db.tables.builds,
      buildLabels: getStore().db.tables.buildLabels,
      baselines: getStore().db.tables.baselines,
    },
    getStore().logger,
  );
  const results = await Promise.all(
    projects.map((project) =>
      retention.purge(project, { ttlDays, keepLatestPerBranch: true, lifecycle }),
    ),
  );
  const sum = (pick: (result: (typeof results)[number]) => number | undefined): number =>
    results.reduce((total, result) => total + (pick(result) ?? 0), 0);
  // With the capability the totals exist even when there is no project (zeros).
  const claimed = Boolean(lifecycle);
  return {
    removedBuilds: sum((result) => result.removedBuilds),
    ...(claimed
      ? {
          protectedBuilds: sum((result) => result.protectedBuilds),
          resumedBuilds: sum((result) => result.resumedBuilds),
        }
      : {}),
  };
}

// oxlint-disable-next-line typescript/promise-function-async
async function purgeBranches(): Promise<{ removedBranches: number; removedBaselines: number }> {
  // `null` turns branch GC off; only an unset value takes the default.
  const { branchTtlDays } = getStore().config;
  const branchTtl = branchTtlDays === undefined ? 30 : branchTtlDays;
  if (branchTtl === null) {
    return { removedBranches: 0, removedBaselines: 0 };
  }
  const projects = await new ProjectModel(getStore().db).list();
  const retention = new Retention(
    getStore().db,
    getStore().storage,
    {
      builds: getStore().db.tables.builds,
      buildLabels: getStore().db.tables.buildLabels,
      baselines: getStore().db.tables.baselines,
    },
    getStore().logger,
  );
  const results = await Promise.all(
    projects.map((project) => retention.purgeStaleBranches(project, branchTtl)),
  );
  const removedBranches = results.reduce(
    (sum: number, r: { removedBranches: number }) => sum + r.removedBranches,
    0,
  );
  const removedBaselines = results.reduce(
    (sum: number, r: { removedBaselines: number }) => sum + r.removedBaselines,
    0,
  );
  return { removedBranches, removedBaselines };
}
