import { describe, expect, it, vi } from "vitest";
import { BuildModel } from "../../models/build.ts";
import { ProjectModel } from "../../models/project.ts";
import { createTestBuild, createTestProject } from "../../test-helpers/create-project.ts";
import { makeDatabase } from "../../test-helpers/fake-adapters.ts";
import { stubLogger } from "../consumer/test-fixtures.ts";
import { createPublishCompleter, type AfterPublishHook } from "./complete.ts";

async function setup(
  options: { captureWillRun?: boolean; branch?: string; reviewEnabled?: boolean } = {},
) {
  const { db } = makeDatabase();
  const project = await createTestProject(db, db.tables);
  if (options.reviewEnabled !== undefined) {
    await new ProjectModel(db).update(project.id, { reviewEnabled: options.reviewEnabled });
  }
  const build = await createTestBuild(db, db.tables, project.id, {
    gitBranch: options.branch ?? project.gitDefaultBranch,
  });
  const hooks: AfterPublishHook[] = [];
  const log = stubLogger();
  const completer = createPublishCompleter({
    db,
    captureWillRun: options.captureWillRun ?? false,
    afterPublish: hooks,
    logger: log.logger,
  });
  const statusOf = async (): Promise<string | undefined> =>
    (await new BuildModel(db).get(build.id))?.status;
  return { db, build, completer, hooks, log, statusOf };
}

describe("createPublishCompleter", () => {
  it("approves a published default-branch build without capture", async () => {
    const { build, completer, statusOf } = await setup();
    const done = await completer.complete(build.id, { ok: true });
    expect(done?.status).toBe("approved");
    expect(await statusOf()).toBe("approved");
  });

  it("is idempotent: a second completion changes nothing and a later status survives", async () => {
    const { db, build, completer, statusOf } = await setup();
    await completer.complete(build.id, { ok: true });
    await new BuildModel(db).setStatus(build.id, "rejected");
    await completer.complete(build.id, { ok: true });
    await completer.complete(build.id, { ok: false, error: "late" });
    expect(await statusOf()).toBe("rejected");
  });

  it("fails the build when publishing failed, and logs the error", async () => {
    const { build, completer, statusOf, log } = await setup();
    await completer.complete(build.id, { ok: false, error: "zip too big" });
    expect(await statusOf()).toBe("failed");
    expect(log.calls.some((c) => c.level === "error" && c.message === "publish failed")).toBe(true);
  });

  it("leaves a non-default branch pending", async () => {
    const { build, completer, statusOf } = await setup({ branch: "feature/x" });
    await completer.complete(build.id, { ok: true });
    expect(await statusOf()).toBe("pending");
  });

  it("accepts a non-default branch when review is off, once, with the hooks still running", async () => {
    const { build, completer, hooks, statusOf } = await setup({
      branch: "feature/x",
      reviewEnabled: false,
    });
    const hook = vi.fn(async () => {});
    hooks.push(hook);
    await completer.complete(build.id, { ok: true });
    expect(await statusOf()).toBe("approved");
    expect(hook).toHaveBeenCalledOnce();
    await completer.complete(build.id, { ok: true });
    expect(await statusOf()).toBe("approved");
  });

  it("holds a non-default branch when review is explicitly on", async () => {
    const { build, completer, statusOf } = await setup({
      branch: "feature/x",
      reviewEnabled: true,
    });
    await completer.complete(build.id, { ok: true });
    expect(await statusOf()).toBe("pending");
  });

  it("leaves the status to capture when one will run", async () => {
    const { build, completer, statusOf } = await setup({ captureWillRun: true });
    await completer.complete(build.id, { ok: true });
    expect(await statusOf()).toBe("pending");
    await completer.complete(build.id, { ok: false, error: "x" });
    expect(await statusOf()).toBe("pending");
  });

  it("resolves null for a build that is gone", async () => {
    const { completer } = await setup();
    expect(await completer.complete("ghost", { ok: true })).toBeNull();
  });

  it("runs hooks in order with the settled build, and survives a failing hook", async () => {
    const { build, completer, hooks, log } = await setup();
    const seen: string[] = [];
    hooks.push(
      async () => {
        seen.push("first");
        await Promise.resolve();
        throw new Error("boom");
      },
      async (context) => {
        seen.push(`second:${context.build.status}:${String(context.outcome.ok)}`);
        await Promise.resolve();
      },
    );
    await completer.complete(build.id, { ok: true });
    expect(seen).toEqual(["first", "second:approved:true"]);
    expect(log.calls.some((c) => c.message === "afterPublish hook failed")).toBe(true);
  });

  it("reads hooks registered after creation", async () => {
    const { build, completer, hooks } = await setup();
    const hook = vi.fn(async () => {});
    hooks.push(hook);
    await completer.complete(build.id, { ok: true });
    expect(hook).toHaveBeenCalledOnce();
  });
});
