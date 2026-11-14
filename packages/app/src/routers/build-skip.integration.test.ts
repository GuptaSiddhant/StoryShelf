import { catalogueBuild } from "@storyshelf/core/capture";
import { BuildModel, LabelModel } from "@storyshelf/core/models";
import {
  createTestBuild,
  createTestProject,
  makeDatabase,
  makeStorage,
} from "@storyshelf/core/test-helpers";
import type { BuildStatus } from "@storyshelf/core/types";
import { storybookDir } from "@storyshelf/core/utils";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

const SKIP_SOURCE = "/api/v1/projects/web/builds/skip-source";
const SKIPPED = "/api/v1/projects/web/builds/skipped";

/** The stories every seeded source build has, and so what `post` sends as `entryIds` by default. */
const STORIES = ["button--primary", "button--secondary"];

function indexOf(ids: string[]): unknown {
  return {
    v: 5,
    entries: Object.fromEntries(
      ids.map((id) => [
        id,
        { id, title: "Button", name: id, importPath: "./src/Button.stories.tsx", type: "story" },
      ]),
    ),
  };
}

type Setup = { testing?: boolean; skippedBuilds?: boolean; runTests?: boolean };

async function seed({ testing = true, skippedBuilds = true, runTests = false }: Setup = {}) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const project = await createTestProject(db, db.tables, { name: "web", runTests });
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    config: { secret: "s" },
    ...(testing ? { testing: { runner: stubRunner() } } : {}),
    ...(skippedBuilds ? { skippedBuilds: true } : {}),
  });
  let minute = 0;
  /** A build on `branch` created `minute` minutes after the last one, in `status`. */
  const build = async (sha: string, status: BuildStatus, branch = "main") => {
    minute += 1;
    const created = await createTestBuild(db, db.tables, project.id, {
      gitSha: sha,
      gitBranch: branch,
    });
    const at = new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
    await db.update(db.tables.builds, created.id, { status, createdAt: at, updatedAt: at });
    objects.set(
      `${storybookDir(project.id, created.id)}/index.json`,
      Buffer.from(JSON.stringify(indexOf(STORIES))),
    );
    await catalogueBuild({ db, storage }, project.id, created.id);
    return created;
  };
  let key = 0;
  const hint = async (sha = "head", branch = "main") =>
    await (await app.request(`${SKIP_SOURCE}?branch=${branch}&sha=${sha}`)).json();
  const post = async (sourceBuildId: string, extra: Record<string, unknown> = {}) =>
    await app.request(SKIPPED, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        gitSha: "head",
        gitBranch: "main",
        sourceBuildId,
        changedFiles: ["README.md"],
        entryIds: STORIES,
        idempotencyKey: `key-${(key += 1)}`,
        ...extra,
      }),
    });
  const act = async (id: string, path: string, body?: unknown) =>
    await app.request(`/api/v1/projects/web/builds/${id}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { app, db, project, build, hint, post, act, storage };
}

describe("GET /builds/skip-source: which candidate may be skipped from", () => {
  it.each<[BuildStatus, boolean]>([
    ["approved", true],
    ["pending", false],
    ["capturing", false],
    ["comparing", false],
    ["reviewing", false],
    ["rejected", false],
    ["failed", false],
    ["cancelled", false],
  ])("a %s candidate: eligible is %s", async (status, eligible) => {
    const { build, hint } = await seed();
    const source = await build("base", status);
    expect(await hint()).toEqual(eligible ? { sourceBuildId: source.id, sha: "base" } : null);
  });

  it("answers null for the first build on a branch", async () => {
    const { hint } = await seed();
    expect(await hint()).toBeNull();
  });

  it("is blocked by a newer build that is not approved, not passed over for an older approved one", async () => {
    const { build, hint } = await seed();
    await build("old", "approved");
    await build("newer", "reviewing");
    expect(await hint()).toBeNull();
  });

  it("ignores builds of the same commit and of other branches", async () => {
    const { build, hint } = await seed();
    const source = await build("base", "approved");
    await build("head", "rejected");
    await build("other", "rejected", "feature");
    expect(await hint()).toEqual({ sourceBuildId: source.id, sha: "base" });
  });

  it("resolves a skipped candidate to its real source while that source is approved", async () => {
    const { db, build, hint } = await seed();
    const source = await build("base", "approved");
    const skipped = await new BuildModel(db).createSkipped({
      projectId: source.projectId,
      gitSha: "mid",
      gitBranch: "main",
      sourceBuildId: source.id,
      changedFiles: [],
    });
    expect(skipped.status).toBe("skipped");
    expect(await hint()).toEqual({ sourceBuildId: source.id, sha: "base" });
    await db.update(db.tables.builds, source.id, { status: "rejected" });
    expect(await hint()).toBeNull();
  });

  it("answers null for a project that runs Storybook tests", async () => {
    const { build, hint } = await seed({ runTests: true });
    await build("base", "approved");
    expect(await hint()).toBeNull();
  });

  it("answers 404 on a hosting-only instance and while skipped builds are off", async () => {
    for (const setup of [{ testing: false }, { skippedBuilds: false }]) {
      // oxlint-disable-next-line no-await-in-loop -- each setup is its own app
      const { app } = await seed(setup);
      // oxlint-disable-next-line no-await-in-loop -- see above
      expect((await app.request(`${SKIP_SOURCE}?branch=main&sha=head`)).status).toBe(404);
    }
  });
});

describe("POST /builds/skipped", () => {
  it("creates the skipped build and answers with its id and page URL", async () => {
    const { build, post, db } = await seed();
    const source = await build("base", "approved");
    const response = await post(source.id, { message: "docs", author: { name: "Ada" } });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { build: Record<string, unknown>; buildUrl: string };
    expect(body.build).toMatchObject({
      status: "skipped",
      gitSha: "head",
      skippedFromBuildId: source.id,
      baselineSha: "base",
      message: "docs",
      authorName: "Ada",
    });
    expect(body.buildUrl).toContain(String(body.build["id"]));
    expect(
      JSON.parse(String((await new BuildModel(db).get(String(body.build["id"])))?.changedFiles)),
    ).toEqual(["README.md"]);
  });

  it("answers 409 when the source was rejected between the hint and the POST", async () => {
    const { build, hint, post, db } = await seed();
    const source = await build("base", "approved");
    expect(await hint()).toEqual({ sourceBuildId: source.id, sha: "base" });
    await db.update(db.tables.builds, source.id, { status: "rejected" });
    const response = await post(source.id);
    expect(response.status).toBe(409);
    expect(await new BuildModel(db).list(source.projectId, { status: "skipped" })).toEqual([]);
  });

  it("answers 409 when a newer build appeared, a source on another branch, or an unknown source", async () => {
    const { build, post } = await seed();
    const source = await build("base", "approved");
    const other = await build("elsewhere", "approved", "feature");
    expect((await post(other.id)).status).toBe(409);
    expect((await post("missing")).status).toBe(409);
    await build("newer", "pending");
    expect((await post(source.id)).status).toBe(409);
  });

  it("answers 409 when a story was added, removed or renamed since the source", async () => {
    const { build, post, db } = await seed();
    const source = await build("base", "approved");
    for (const entryIds of [
      [...STORIES, "button--added"],
      [STORIES[0]],
      [STORIES[0], "button--renamed"],
      [],
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- one request at a time
      expect((await post(source.id, { entryIds })).status).toBe(409);
    }
    expect(await new BuildModel(db).list(source.projectId, { status: "skipped" })).toEqual([]);
  });

  it("accepts the entry ids in any order, and answers 409 for a source with no catalog", async () => {
    const { build, post, db, project } = await seed();
    const source = await build("base", "approved");
    expect((await post(source.id, { entryIds: [...STORIES].toReversed() })).status).toBe(201);
    const bare = await createTestBuild(db, db.tables, project.id, {
      gitSha: "bare",
      gitBranch: "other",
    });
    await db.update(db.tables.builds, bare.id, { status: "approved" });
    expect((await post(bare.id, { gitBranch: "other" })).status).toBe(409);
  });

  it("returns the build a repeated idempotencyKey already created", async () => {
    const { build, post, db } = await seed();
    const source = await build("base", "approved");
    const first = await post(source.id, { idempotencyKey: "run-1" });
    expect(first.status).toBe(201);
    const created = (await first.json()) as { build: { id: string } };
    const again = await post(source.id, { idempotencyKey: "run-1" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { build: { id: string } }).build.id).toBe(created.build.id);
    expect(await new BuildModel(db).list(source.projectId, { status: "skipped" })).toHaveLength(1);
    expect((await post(source.id, { idempotencyKey: "run-2" })).status).toBe(201);
  });

  it("attaches labels, including persistent", async () => {
    const { build, post, db } = await seed();
    const source = await build("base", "approved");
    const labels = [
      { key: "persistent", value: "true" },
      { key: "team", value: "web" },
    ];
    const created = (await (await post(source.id, { labels })).json()) as { build: { id: string } };
    const attached = await new LabelModel(db).listForBuild(created.build.id);
    expect(attached.map((label) => [label.typeKey, label.value]).toSorted()).toEqual([
      ["persistent", "true"],
      ["team", "web"],
    ]);
    expect((await post(source.id, { labels: [{ key: "", value: "x" }] })).status).toBe(400);
  });

  it("is replaced by a normal build of the same commit", async () => {
    const { app, build, post, db, project } = await seed();
    const source = await build("base", "approved");
    const skipped = (await (await post(source.id)).json()) as { build: { id: string } };
    const other = await new BuildModel(db).createSkipped({
      projectId: project.id,
      gitSha: "elsewhere",
      gitBranch: "main",
      sourceBuildId: source.id,
      changedFiles: [],
    });
    const response = await app.request("/api/v1/projects/web/builds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gitSha: "head", gitBranch: "main" }),
    });
    const replacement = (await response.json()) as { id?: string; build?: { id: string } };
    const replacementId = replacement.id ?? replacement.build?.id;
    expect(replacementId).toBeTruthy();
    const models = new BuildModel(db);
    expect((await models.get(skipped.build.id))?.supersededByBuildId).toBe(replacementId);
    expect((await models.get(other.id))?.supersededByBuildId ?? null).toBeNull();
  });

  it("answers 409 for a project that runs Storybook tests", async () => {
    const { build, post } = await seed({ runTests: true });
    const source = await build("base", "approved");
    expect((await post(source.id)).status).toBe(409);
  });

  it("answers 404 on a hosting-only instance and while skipped builds are off", async () => {
    for (const setup of [{ testing: false }, { skippedBuilds: false }]) {
      // oxlint-disable-next-line no-await-in-loop -- each setup is its own app
      const { build, post } = await seed(setup);
      // oxlint-disable-next-line no-await-in-loop -- see above
      const source = await build("base", "approved");
      // oxlint-disable-next-line no-await-in-loop -- see above
      expect((await post(source.id)).status).toBe(404);
    }
  });

  it("rejects a malformed body", async () => {
    const { post } = await seed();
    expect((await post("x", { changedFiles: "README.md" })).status).toBe(400);
  });
});

describe("a skipped build cannot be acted on", () => {
  it.each([
    ["reviews", { verdict: "approved" }],
    ["retry", undefined],
    ["cancel", undefined],
    ["rediff", undefined],
    ["approve-all", undefined],
    ["reject-all", undefined],
  ])("%s answers 409", async (path, body) => {
    const { build, post, act, db } = await seed();
    const source = await build("base", "approved");
    const created = (await (await post(source.id)).json()) as { build: { id: string } };
    expect((await act(created.build.id, path, body)).status).toBe(409);
    expect((await new BuildModel(db).get(created.build.id))?.status).toBe("skipped");
  });
});
