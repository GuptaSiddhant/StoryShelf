import { BuildModel, CaptureAttemptModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import { createTestBuild, createTestProject, makeDatabase } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const requested = vi.hoisted(() => [] as string[]);
const store = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../git-status.ts", () => ({
  requestBuildState: vi.fn(async (buildId: string) => {
    requested.push(buildId);
    await Promise.resolve();
  }),
}));
vi.mock("../store.ts", () => ({ getStore: () => store.current }));

const { runSwitchOffPass } = await import("./review-switch-off.ts");

async function setup() {
  const { db } = makeDatabase();
  store.current = { db, logger: pino({ level: "silent" }) };
  const project = await createTestProject(db, db.tables);
  const idle = await createTestBuild(db, db.tables, project.id, { gitSha: "a" });
  const attempted = await createTestBuild(db, db.tables, project.id, { gitSha: "b" });
  await new CaptureAttemptModel(db).startAttempt(project.id, attempted.id);
  const off = { ...project, reviewEnabled: false } as Project;
  return { db, project, off, idle, attempted };
}

describe("the switch-off pass at the app level", () => {
  beforeEach(() => {
    requested.length = 0;
  });

  it("accepts the idle pending builds and asks for git state once for each", async () => {
    const { db, project, off, idle, attempted } = await setup();
    expect(await runSwitchOffPass(project, off)).toBe(1);
    expect(requested).toEqual([idle.id]);
    const builds = new BuildModel(db);
    expect((await builds.get(idle.id))?.status).toBe("approved");
    expect((await builds.get(attempted.id))?.status).toBe("pending");
  });

  it("does nothing when review stays on, was already off, or is turned on", async () => {
    const { project, off } = await setup();
    expect(await runSwitchOffPass(project, project)).toBe(0);
    expect(await runSwitchOffPass(off, off)).toBe(0);
    expect(await runSwitchOffPass(off, project)).toBe(0);
    expect(requested).toEqual([]);
  });

  it("finds nothing the second time, so no build is asked about twice", async () => {
    const { project, off, idle } = await setup();
    await runSwitchOffPass(project, off);
    expect(await runSwitchOffPass(project, off)).toBe(0);
    expect(requested).toEqual([idle.id]);
  });
});
