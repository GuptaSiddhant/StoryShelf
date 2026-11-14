/**
 * A CI upload that names the default branch (#910): with the git host saying the commit is not on
 * it, the build is reviewed like a feature branch: no auto-approval, no default-branch baseline
 * and no passing status. Through the real app: the build API, the capture queue and the channel.
 */
import type { CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import { makeDatabase, makeFakeStateNotifier, makeStorage } from "@storyshelf/core/test-helpers";
import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "./index.tsx";

const SHA = "b".repeat(40);
const BASE = "https://shelf.example.com";
const STORY = {
  id: "button--primary",
  title: "Button",
  name: "Primary",
  importPath: "./Button.stories.tsx",
  type: "story",
} as const;

function runner(): CaptureRunner {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64),
  ]);
  return {
    metadata: { name: "Fake", version: "0.0.0", kind: "fake", category: "capture-runner" },
    render: vi.fn(async () => {
      await Promise.resolve();
      return {
        captures: [{ story: STORY, viewportName: "desktop", screenshot: png }],
        failures: [],
      };
    }),
    cancel: vi.fn(async () => {
      await Promise.resolve();
    }),
  };
}

function zip(): Uint8Array<ArrayBuffer> {
  const archive = new AdmZip();
  archive.addFile(
    "index.json",
    Buffer.from(JSON.stringify({ v: 4, entries: { [STORY.id]: STORY } })),
  );
  return new Uint8Array(archive.toBuffer());
}

let scratchDir: string;
beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-claim-"));
});
afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

async function json(
  app: ReturnType<typeof createShelfApp>,
  method: string,
  path: string,
  body?: unknown,
) {
  return await app.request(`/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Upload a `main` build to a project whose git host answers `onBranch`, and wait for capture. */
async function uploadMain(onBranch?: boolean) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const git = makeFakeStateNotifier("github", undefined, undefined, onBranch ?? true);
  const app = createShelfApp({
    database: db,
    storage,
    testing: { runner: runner(), concurrency: 1 },
    config: { scratchDir, secret: "test-secret", publicBaseUrl: BASE },
    notifications: { notifiers: [git.provider] },
    logger: pino({ level: "silent" }),
  });
  const project = (await (await json(app, "POST", "/projects", { name: "Claims" })).json()) as {
    slug: string;
  };
  if (onBranch !== undefined) {
    const channel = await json(app, "POST", `/projects/${project.slug}/notification-channels`, {
      provider: "github",
      config: { owner: "acme", repo: "web" },
      secret: "ghp_token",
    });
    expect(channel.status).toBe(201);
  }
  const created = (await (
    await json(app, "POST", `/projects/${project.slug}/builds`, { gitSha: SHA, gitBranch: "main" })
  ).json()) as { build: { id: string }; uploadUrl: string };
  const put = await app.request(created.uploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/zip" },
    body: zip(),
  });
  expect(put.status).toBe(202);
  const path = `/projects/${project.slug}/builds/${created.build.id}`;
  const build = await vi.waitFor(
    async () => {
      const row = (await (await json(app, "GET", path)).json()) as Record<string, unknown>;
      expect(["approved", "reviewing"]).toContain(row["status"]);
      return row;
    },
    { timeout: 3000, interval: 10 },
  );
  return { app, db, git, build };
}

/** The last `<prefix>/testing` status the channel was asked to show. */
function lastTesting(git: ReturnType<typeof makeFakeStateNotifier>) {
  const testing = git.calls.filter(
    (call) => call.target.kind === "status" && call.target.context === "storyshelf/testing",
  );
  const last = testing.at(-1);
  return last?.target.kind === "status"
    ? { state: last.state, description: last.target.description }
    : undefined;
}

describe("a default-branch claim through the app", () => {
  it("cannot change default-branch baselines or post a passing status when the commit is not on main", async () => {
    const { db, git, build } = await uploadMain(false);
    expect(build).toMatchObject({
      status: "reviewing",
      isDefault: false,
      branchVerified: "refused",
    });
    expect(await db.list(db.tables.baselines)).toHaveLength(0);
    await vi.waitFor(() => {
      expect(lastTesting(git)).toEqual({
        state: "pending",
        description: "Commit is not on main: 1 change to review",
      });
    });
    expect(
      git.calls.some(
        (call) =>
          call.target.kind === "status" &&
          call.target.context === "storyshelf/testing" &&
          call.state === "success",
      ),
    ).toBe(false);
  });

  it("auto-approves as before when the git host confirms the commit", async () => {
    const { db, build } = await uploadMain(true);
    expect(build).toMatchObject({
      status: "approved",
      isDefault: true,
      branchVerified: "verified",
    });
    expect(await db.list(db.tables.baselines)).toHaveLength(1);
  });

  it("needs review with no git channel, until an admin turns verification off", async () => {
    const { db, build } = await uploadMain();
    expect(build).toMatchObject({ status: "reviewing", branchVerified: "unverified" });
    expect(await db.list(db.tables.baselines)).toHaveLength(0);
  });
});

describe("the requireVerifiedDefault project setting", () => {
  it("is on by default, and an admin can turn it off through the API", async () => {
    const { app } = await uploadMain();
    const listed = (await (await json(app, "GET", "/projects")).json()) as {
      slug: string;
      requireVerifiedDefault?: boolean;
    }[];
    const project = listed[0];
    // The fake database applies no column defaults; the real column defaults to true.
    expect(project?.requireVerifiedDefault ?? true).toBe(true);
    const patched = await json(app, "PATCH", `/projects/${project?.slug ?? ""}`, {
      requireVerifiedDefault: false,
    });
    expect(
      ((await patched.json()) as { requireVerifiedDefault?: boolean }).requireVerifiedDefault,
    ).toBe(false);
    expect(
      (
        await json(app, "PATCH", `/projects/${project?.slug ?? ""}`, {
          requireVerifiedDefault: "no",
        })
      ).status,
    ).toBe(400);
  });
});
