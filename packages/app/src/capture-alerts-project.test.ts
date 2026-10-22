import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import { makeDatabase } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";

const notifyProjectWith = vi.fn(async () => {});
const notifySystemWith = vi.fn(async () => {});
vi.mock("./notify.ts", () => ({ notifyProjectWith, notifySystemWith }));

const { notifyCaptureFailed } = await import("./capture-alerts.ts");

describe("notifyCaptureFailed: project topic", () => {
  it("also dispatches the project-scoped build:failed event, next to the admin alert", async () => {
    const { db } = makeDatabase();
    const project = await new ProjectModel(db).create({ name: "Failed topic" });
    const builds = new BuildModel(db);
    const build = await builds.create(project.id, { gitSha: "sha", gitBranch: "main" });
    await builds.setStatus(build.id, "failed");
    const logger = createShelfLogger({ level: "silent" });
    await notifyCaptureFailed({ database: db } as never, {}, logger, build.id);
    expect(notifySystemWith).toHaveBeenCalledTimes(1);
    expect(notifyProjectWith).toHaveBeenCalledTimes(1);
    const call = notifyProjectWith.mock.calls[0] as unknown as [
      unknown,
      { id: string },
      string,
      unknown,
      string,
    ];
    expect(call[1].id).toBe(project.id);
    expect(call[2]).toBe("build:failed");
    expect(call[3]).toEqual({ buildId: build.id, status: "failed" });
    expect(call[4]).toBe(`/builds/${build.id}`);
  });
});
