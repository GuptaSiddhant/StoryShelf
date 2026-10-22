import { createShelfApp } from "@storyshelf/app";
import type { StoryEntry } from "@storyshelf/core/adapter/capture-runner";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import type { Build, Snapshot } from "@storyshelf/core/schema";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createLocalStorage } from "@storyshelf/storage-local";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlaywrightCaptureRunner } from "./capture-runner.ts";
import { ensureFixtureBuilt, readJson, uploadBuild, waitForBuild } from "./integration-harness.ts";

let harness: {
  app: ReturnType<typeof createShelfApp>;
  db: DatabaseAdapter;
  storage: StorageAdapter;
  staticDir: string;
  tmp: string;
} | null = null;

function getHarness(): NonNullable<typeof harness> {
  if (!harness) {
    throw new Error("Integration test harness not initialized");
  }
  return harness;
}

async function createHarness(): Promise<void> {
  const staticDir = await ensureFixtureBuilt();
  const tmp = await mkdtemp(join(tmpdir(), "storyshelf-int-"));
  const dataDir = join(tmp, "data");
  await mkdir(dataDir, { recursive: true });
  const db = createSqliteDatabase(join(tmp, "shelf.db"));
  const storage = createLocalStorage(dataDir);
  const runner = createPlaywrightCaptureRunner({ browsers: ["chromium", "firefox"] });
  const app = createShelfApp({
    database: db,
    storage,
    testing: { runner, concurrency: 1 },
    config: { scratchDir: dataDir, purgeTtlDays: 30 },
  });
  await app.lifecycle.setup();
  harness = { app, db, storage, staticDir, tmp };
}

/**
 * Brightness (0–255) of a PNG's first pixel. The first scanline has no row
 * above, so every PNG filter reduces to the raw bytes for pixel 0.
 */
function firstPixelBrightness(png: Buffer): number {
  const colorType = png[25];
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      idat.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const [red = 0, green = 0, blue = 0] = raw.subarray(1, 1 + bytesPerPixel);
  return (red + green + blue) / 3;
}

const a11yStory = (name: string): StoryEntry => ({
  id: `components-accessibility--${name}`,
  title: "Components/Accessibility",
  name,
  type: "story",
});

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")("browser integration smoke", () => {
  beforeAll(async () => {
    await createHarness();
  }, 300_000);

  afterAll(async () => {
    const current = harness;
    harness = null;
    if (!current) {
      return;
    }
    await current.app.lifecycle.teardown();
    await rm(current.tmp, { recursive: true, force: true });
  });

  it("captures a build end-to-end: upload, capture, diff, review approve", async () => {
    const { app, storage, staticDir } = getHarness();

    const projectResponse = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Integration Smoke" }),
    });
    expect(projectResponse.status).toBe(201);
    const project = await readJson<{ id: string; slug: string }>(projectResponse);

    const snapshotsFor = async (buildId: string): Promise<Snapshot[]> => {
      const response = await app.request(
        `/api/v1/projects/${project.slug}/builds/${buildId}/snapshots`,
      );
      return readJson<Snapshot[]>(response);
    };

    const uploaded = await uploadBuild(app, project.slug, staticDir, {
      gitSha: "a".repeat(40),
      gitBranch: "feature/smoke",
      message: "first smoke build",
    });
    const first = await waitForBuild(app, project.slug, uploaded.id, ["reviewing"]);
    expect(first.status).toBe("reviewing");
    expect(first.snapshotCount).toBeGreaterThan(0);
    expect(first.changedCount).toBe(first.snapshotCount);

    const firstSnapshots = await snapshotsFor(first.id);
    expect(firstSnapshots.length).toBe(first.snapshotCount);
    for (const snapshot of firstSnapshots) {
      expect(snapshot.status).toBe("new");
    }

    const [probe] = firstSnapshots;
    if (!probe) {
      throw new Error("Expected at least one snapshot");
    }
    // Screenshots are stored by content, so the row, not the story identity, says where.
    expect(probe.screenshotPath).toMatch(/\/content\/[0-9a-f]{64}\.png$/u);
    const screenshot = await storage.read(probe.screenshotPath);
    expect(screenshot.length).toBeGreaterThan(0);

    const approveResponse = await app.request(
      `/api/v1/projects/${project.slug}/builds/${first.id}/approve-all`,
      {
        method: "POST",
      },
    );
    expect(approveResponse.status).toBe(200);
    const reviewed = await readJson<Build>(
      await app.request(`/api/v1/projects/${project.slug}/builds/${first.id}`),
    );
    expect(reviewed.status).toBe("approved");

    const uploadedSecond = await uploadBuild(app, project.slug, staticDir, {
      gitSha: "a".repeat(40),
      gitBranch: "feature/smoke",
      message: "second smoke build",
    });
    const second = await waitForBuild(app, project.slug, uploadedSecond.id, ["approved"]);
    expect(second.status).toBe("approved");
    // Same commit already approved on this branch: capture is skipped, so no
    // snapshots are produced. The skip is recorded in the attempt log.
    expect(second.snapshotCount).toBe(0);
    const attempts = await readJson<Array<{ attemptNo: number }>>(
      await app.request(`/api/v1/projects/${project.slug}/builds/${second.id}/attempts`),
    );
    expect(attempts.length).toBeGreaterThan(0);
    const logs = await readJson<Array<{ message: string }>>(
      await app.request(
        `/api/v1/projects/${project.slug}/builds/${second.id}/attempts/${attempts[0]?.attemptNo}/logs`,
      ),
    );
    expect(logs.some((line) => line.message.includes("duplicate sha already approved"))).toBe(true);
  }, 300_000);

  it("interaction: play, flaky and disableSnapshot", async () => {
    const { app, staticDir } = getHarness();

    // Create a project with executePlay enabled (opt-in)
    const projectResponse = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Play Smoke", executePlay: true, playTimeoutMs: 5000 }),
    });
    expect(projectResponse.status).toBe(201);
    const project = await readJson<{ id: string; slug: string }>(projectResponse);

    const build = await uploadBuild(app, project.slug, staticDir, {
      gitSha: "b".repeat(40),
      gitBranch: "feature/play",
      message: "play smoke",
    });

    // Poll until terminal. Play results land after snapshots, so the build
    // passes through "reviewing" first — wait specifically for "failed"
    // (expected because BlockingFailure is not flaky).
    const final = await waitForBuild(app, project.slug, build.id, ["failed"]);

    // Non-flaky play failure blocks the build
    expect(final.status).toBe("failed");

    const logsRes = await app.request(
      `/api/v1/projects/${project.slug}/builds/${final.id}/attempts/1/logs`,
    );
    const logs =
      await readJson<{ level: string; message: string; fields: string | null }[]>(logsRes);
    const storyIdsOf = (predicate: (l: { level: string; message: string }) => boolean) =>
      logs
        .filter((l) => predicate(l))
        .map((l) => (JSON.parse(l.fields ?? "{}") as { storyId?: string }).storyId)
        .filter((id): id is string => id !== undefined);
    // Exactly one blocking failure (BlockingFailure); flaky play failures are warnings only
    const attemptRes = await app.request(
      `/api/v1/projects/${project.slug}/builds/${final.id}/attempts/1`,
    );
    const attempt = await readJson<{ failedCount: number }>(attemptRes);
    expect(attempt.failedCount).toBe(1);
    // The attempt log records the blocking render failure as the only error line;
    // flaky failures are downgraded to warnings.
    expect(storyIdsOf((l) => l.level === "error")).toEqual(["components-button--blocking-failure"]);
    const flaky = storyIdsOf((l) => l.message.includes("flaky story failed"));
    expect(new Set(flaky)).toEqual(
      new Set([
        "components-button--flaky-tag",
        "components-button--flaky-param",
        "components-button--chromatic-flaky",
      ]),
    );
    // Disabled story is not counted
    expect(final.snapshotCount).toBeGreaterThan(0);
    // 7 plain captures + 5 from the Themed modes stories + 5 accessibility stories; the disabled story adds none.
    expect(final.snapshotCount).toBeLessThan(18);

    const res = await app.request(`/api/v1/projects/${project.slug}/builds/${final.id}/snapshots`);
    const snapshots = await readJson<Snapshot[]>(res);
    const ids = new Set(snapshots.map((s) => s.storyId));
    // Stories without a play function (and the flaky ones) are still captured
    expect(ids.has("components-button--primary")).toBe(true);
    expect(ids.has("components-button--disabled")).toBe(false);
  }, 300_000);

  it("a11y: axe annotates violations, honours parameters.a11y, and never fails the build", async () => {
    const { app, staticDir } = getHarness();

    // Runner level: the annotation text names the rule.
    const rendered = await createPlaywrightCaptureRunner({ concurrency: 1 }).render({
      buildId: "a11y-direct",
      storybookDir: staticDir,
      stories: [
        ...[
          "missing-alt",
          "low-contrast",
          "clean",
          "disabled-a11y",
          "rule-override",
          "best-practice",
        ].map((name) => a11yStory(name)),
        {
          id: "components-button--primary",
          title: "Components/Button",
          name: "Primary",
          type: "story",
        },
      ],
      viewports: [{ name: "desktop", width: 1280, height: 720 }],
      runA11y: true,
    });
    const annotation = (id: string): string =>
      rendered.failures.find((failure) => failure.storyId === id)?.error ?? "";
    expect(rendered.captures).toHaveLength(7);
    // Existing fixture stories stay clean.
    expect(annotation("components-button--primary")).toBe("");
    expect(annotation("components-accessibility--missing-alt")).toMatch(
      /^a11y: .*image-alt \(critical\)/u,
    );
    expect(annotation("components-accessibility--missing-alt")).toContain("button-name");
    expect(annotation("components-accessibility--low-contrast")).toContain("color-contrast");
    // The default run set includes best-practice rules (#243).
    expect(annotation("components-accessibility--best-practice")).toContain("heading-order");
    expect(annotation("components-accessibility--clean")).toBe("");
    expect(annotation("components-accessibility--disabled-a11y")).toBe("");
    // config.rules switches image-alt off; the other violation is still reported.
    expect(annotation("components-accessibility--rule-override")).toContain("button-name");
    expect(annotation("components-accessibility--rule-override")).not.toContain("image-alt");

    // Build level: annotation-only, so the build is reviewable, not failed.
    const projectResponse = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "A11y Smoke" }),
    });
    const project = await readJson<{ id: string; slug: string; runA11y?: boolean }>(
      projectResponse,
    );
    // Accessibility checks are on by default: nothing switches them on here.
    expect(project.runA11y).toBe(true);
    const uploaded = await uploadBuild(app, project.slug, staticDir, {
      gitSha: "f".repeat(40),
      gitBranch: "feature/a11y",
      message: "a11y smoke",
    });
    const build = await waitForBuild(app, project.slug, uploaded.id, ["reviewing", "failed"]);
    expect(build.status).toBe("reviewing");
    const logs = await readJson<{ message: string; fields: string | null }[]>(
      await app.request(`/api/v1/projects/${project.slug}/builds/${build.id}/attempts/1/logs`),
    );
    const flagged = new Set(
      logs
        .filter((line) => line.message.includes("a11y violations found"))
        .map((line) => (JSON.parse(line.fields ?? "{}") as { storyId?: string }).storyId),
    );
    expect(flagged.has("components-accessibility--missing-alt")).toBe(true);
    expect(flagged.has("components-accessibility--low-contrast")).toBe(true);
    expect(flagged.has("components-accessibility--clean")).toBe(false);
    expect(flagged.has("components-accessibility--disabled-a11y")).toBe(false);

    // The findings are persisted on the snapshot for the review UI.
    const snapshots = await readJson<Snapshot[]>(
      await app.request(`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots`),
    );
    const violationsOf = (storyId: string): string[] => {
      const raw = snapshots.find((snap) => snap.storyId === storyId)?.a11yViolations;
      return raw ? (JSON.parse(raw) as string[]) : [];
    };
    expect(violationsOf("components-accessibility--missing-alt").join(" ")).toContain("image-alt");
    expect(violationsOf("components-accessibility--best-practice").join(" ")).toContain(
      "heading-order",
    );
    expect(violationsOf("components-accessibility--clean")).toEqual([]);
    expect(violationsOf("components-button--primary")).toEqual([]);
  }, 300_000);

  it("modes: theme globals produce distinct, correctly sized captures", async () => {
    const { app, storage, staticDir } = getHarness();
    const projectResponse = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Modes Smoke" }),
    });
    const project = await readJson<{ id: string; slug: string }>(projectResponse);
    const uploaded = await uploadBuild(app, project.slug, staticDir, {
      gitSha: "c".repeat(40),
      gitBranch: "feature/modes",
      message: "modes smoke",
    });
    const build = await waitForBuild(app, project.slug, uploaded.id, ["reviewing"]);
    const snapshots = await readJson<Snapshot[]>(
      await app.request(`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots`),
    );
    const modesOf = (storyId: string): Snapshot[] =>
      snapshots.filter((snapshot) => snapshot.storyId === storyId);

    // `storyshelf` key: the plain desktop capture plus a light and a dark mode.
    const surface = modesOf("components-themed--surface");
    expect(surface.map((snapshot) => snapshot.viewportName).toSorted()).toEqual([
      "dark",
      "desktop",
      "light",
    ]);
    const dark = surface.find((snapshot) => snapshot.viewportName === "dark");
    const light = surface.find((snapshot) => snapshot.viewportName === "light");
    expect(dark?.mode).toBe('{"theme":"dark"}');
    const read = async (snapshot: Snapshot | undefined): Promise<Buffer> =>
      await storage.read(snapshot?.screenshotPath ?? "");
    expect(firstPixelBrightness(await read(dark))).toBeLessThan(40);
    expect(firstPixelBrightness(await read(light))).toBeGreaterThan(215);

    // `chromatic` key alias: a named dark mode at the mobile1 viewport width.
    const alias = modesOf("components-themed--chromatic-alias");
    expect(alias.map((snapshot) => snapshot.viewportName).toSorted()).toEqual([
      "dark-mobile",
      "desktop",
    ]);
    expect(alias.find((snapshot) => snapshot.viewportName === "dark-mobile")).toMatchObject({
      viewportWidth: 320,
      mode: '{"theme":"dark"}',
    });

    // Group approval covers the story/mode; the rest of the build stays open.
    const approve = await app.request(
      `/api/v1/projects/${project.slug}/builds/${build.id}/stories/components-themed--surface/modes/dark/approve`,
      { method: "POST" },
    );
    expect(approve.status).toBe(200);
  }, 300_000);

  it("reports which declared engines are installed, never launching to find out", async () => {
    const runner = createPlaywrightCaptureRunner({ browsers: ["chromium", "firefox", "webkit"] });
    await runner.lifecycle?.setup({} as never);
    const targets = runner.metadata.targets ?? [];
    expect(targets.map((entry) => entry.target)).toEqual(["chromium", "firefox", "webkit"]);
    // Chromium is what these tests render with, so it is installed; the others say which they are.
    expect(targets[0]?.status).toBe("ready");
    for (const entry of targets) {
      expect(entry.status === "ready" || entry.status.unavailable.length > 0).toBe(true);
    }
  });

  it("browsers: per-engine snapshots, shared approval and stable re-capture", async () => {
    const { app, storage, staticDir } = getHarness();
    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Browsers Smoke" }),
    });
    const project = await readJson<{ id: string; slug: string }>(created);
    const patched = await app.request(`/api/v1/projects/${project.slug}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ browsers: ["chromium", "firefox"] }),
    });
    expect(patched.status).toBe(200);

    const snapshotsFor = async (buildId: string): Promise<Snapshot[]> =>
      await readJson<Snapshot[]>(
        await app.request(`/api/v1/projects/${project.slug}/builds/${buildId}/snapshots`),
      );

    const first = await waitForBuild(
      app,
      project.slug,
      (
        await uploadBuild(app, project.slug, staticDir, {
          gitSha: "d".repeat(40),
          gitBranch: "feature/browsers",
          message: "two engines",
        })
      ).id,
      ["reviewing"],
    );
    const snapshots = await snapshotsFor(first.id);
    const engines = (key: string): string[] =>
      snapshots
        .filter((snapshot) => `${snapshot.storyId}/${snapshot.viewportName}` === key)
        .map((snapshot) => snapshot.browser ?? "")
        .toSorted();
    expect(engines("components-button--primary/desktop")).toEqual(["chromium", "firefox"]);
    expect(engines("components-themed--surface/dark")).toEqual(["chromium", "firefox"]);
    const firefox = snapshots.find(
      (snapshot) =>
        snapshot.browser === "firefox" && snapshot.storyId === "components-button--primary",
    );
    expect((await storage.read(firefox?.screenshotPath ?? "")).length).toBeGreaterThan(0);

    // One approval covers the story/mode on both engines and promotes both baselines.
    const group = await app.request(
      `/api/v1/projects/${project.slug}/builds/${first.id}/stories/components-button--primary/modes/desktop/approve`,
      { method: "POST" },
    );
    expect(group.status).toBe(200);
    const afterGroup = await snapshotsFor(first.id);
    expect(
      afterGroup
        .filter((snapshot) => snapshot.storyId === "components-button--primary")
        .map((snapshot) => snapshot.status),
    ).toEqual(["approved", "approved"]);

    await app.request(`/api/v1/projects/${project.slug}/builds/${first.id}/approve-all`, {
      method: "POST",
    });
    const approved = await readJson<Build>(
      await app.request(`/api/v1/projects/${project.slug}/builds/${first.id}`),
    );
    expect(approved.status).toBe("approved");

    // A new commit re-captures on both engines and matches each engine's own baseline.
    const second = await waitForBuild(
      app,
      project.slug,
      (
        await uploadBuild(app, project.slug, staticDir, {
          gitSha: "e".repeat(40),
          gitBranch: "feature/browsers",
          message: "re-capture",
        })
      ).id,
      ["approved"],
    );
    const rechecked = await snapshotsFor(second.id);
    expect(rechecked.length).toBe(snapshots.length);
    expect(new Set(rechecked.map((snapshot) => snapshot.status))).toEqual(new Set(["unchanged"]));
  }, 600_000);
});
