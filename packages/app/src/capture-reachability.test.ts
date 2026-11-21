import { TargetLaunchError } from "@storyshelf/core/adapter/capture-runner";
import { TargetReachability, type ConsumerJob } from "@storyshelf/core/capture";
import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, ProjectModel, SnapshotModel } from "@storyshelf/core/models";
import { makeDatabase } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { notifyTargetChange } from "./capture-alerts.ts";
import type { CaptureHandler } from "./capture-handlers.ts";
vi.mock("./notify.ts", () => ({
  notifySystemWith: vi.fn(async () => {}),
  notifyProjectWith: vi.fn(async () => {}),
}));
const { notifySystemWith } = vi.mocked(await import("./notify.ts"));
import { alertDataOf, renderedTargets, reportingReachability } from "./capture-reachability.ts";

const logger = createShelfLogger({ level: "silent" });

async function renderedBuild(browsers: string[]) {
  const { db } = makeDatabase();
  const project = await new ProjectModel(db).create({ name: "Reach" });
  const build = await new BuildModel(db).create(project.id, { gitSha: "s", gitBranch: "main" });
  await Promise.all(
    browsers.map(
      async (browser, index) =>
        await new SnapshotModel(db).create(project.id, build.id, {
          storyId: `s-${index}`,
          browser,
        } as never),
    ),
  );
  return { db, buildId: build.id };
}

const handlerOf = (run: CaptureHandler["run"]): CaptureHandler => ({ run }) as CaptureHandler;
const jobOf = (buildId: string): ConsumerJob => ({ buildId }) as unknown as ConsumerJob;

describe("reportingReachability", () => {
  it("marks the target unreachable on a launch failure and rethrows it", async () => {
    const { db, buildId } = await renderedBuild([]);
    const reach = new TargetReachability();
    const failure = new TargetLaunchError("chromium@sprite", "WebSocket error: 500");
    const handler = reportingReachability(
      handlerOf(async () => await Promise.reject(failure)),
      reach,
      db,
      logger,
    );
    await expect(handler.run(jobOf(buildId), {} as never)).rejects.toBe(failure);
    expect(reach.unreachable().get("chromium@sprite")?.reason).toBe("connection");
  });

  it("reads the message a forked child sends", async () => {
    const { db, buildId } = await renderedBuild([]);
    const reach = new TargetReachability();
    const handler = reportingReachability(
      handlerOf(async () => await Promise.reject(new Error("Cannot launch firefox: boom"))),
      reach,
      db,
      logger,
    );
    await expect(handler.run(jobOf(buildId), {} as never)).rejects.toThrow("boom");
    expect(reach.unreachable().has("firefox")).toBe(true);
  });

  it("leaves other failures alone", async () => {
    const { db, buildId } = await renderedBuild([]);
    const reach = new TargetReachability();
    const handler = reportingReachability(
      handlerOf(async () => await Promise.reject(new Error("story crashed"))),
      reach,
      db,
      logger,
    );
    await expect(handler.run(jobOf(buildId), {} as never)).rejects.toThrow("story crashed");
    expect(reach.unreachable().size).toBe(0);
  });

  it("clears a target a run rendered on, and alerts once each way", async () => {
    const { db, buildId } = await renderedBuild(["chromium@sprite", "chromium@sprite"]);
    const reach = new TargetReachability();
    const changes = vi.fn();
    reach.onChange = changes;
    await reach.failed("chromium@sprite", "connection");
    const handler = reportingReachability(
      handlerOf(async () => {}),
      reach,
      db,
      logger,
    );
    await handler.run(jobOf(buildId), {} as never);
    await handler.run(jobOf(buildId), {} as never);
    expect(changes.mock.calls.map(([change]) => change.kind)).toEqual(["unreachable", "recovered"]);
    expect(await renderedTargets(db, buildId)).toEqual(["chromium@sprite"]);
  });

  it("never lets a failing reporter change the run", async () => {
    const { db, buildId } = await renderedBuild(["chromium"]);
    const reach = new TargetReachability();
    await reach.failed("chromium", "launch");
    reach.onChange = async () => await Promise.reject(new Error("channel down"));
    const handler = reportingReachability(
      handlerOf(async () => {}),
      reach,
      db,
      logger,
    );
    await expect(handler.run(jobOf(buildId), {} as never)).resolves.toBeUndefined();
  });
});

describe("alerts", () => {
  it("carries the target, class and time, nothing else", () => {
    const since = "2026-11-21T00:00:00.000Z";
    expect(
      alertDataOf({ kind: "unreachable", target: "chromium@sprite", reason: "connection", since }),
    ).toEqual({ target: "chromium@sprite", reason: "connection", since });
    expect(alertDataOf({ kind: "recovered", target: "chromium@sprite", since })).toEqual({
      target: "chromium@sprite",
      since,
    });
  });

  it("sends sys:target-unreachable, then sys:target-recovered, with that data only", async () => {
    const { db } = makeDatabase();
    const options = { database: db } as never;
    const since = "2026-11-21T00:00:00.000Z";
    await notifyTargetChange(options, {}, logger, {
      kind: "unreachable",
      target: "chromium@sprite",
      reason: "connection",
      since,
    });
    await notifyTargetChange(options, {}, logger, {
      kind: "recovered",
      target: "chromium@sprite",
      since,
    });
    expect(notifySystemWith.mock.calls.map(([, event, data]) => [event, data])).toEqual([
      ["sys:target-unreachable", { target: "chromium@sprite", reason: "connection", since }],
      ["sys:target-recovered", { target: "chromium@sprite", since }],
    ]);
  });
});
