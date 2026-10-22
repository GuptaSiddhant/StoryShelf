import type { CaptureRunner, RenderResult } from "@storyshelf/core/adapter/capture-runner";
import type { Build } from "@storyshelf/core/schema";
import { makeDatabase, makeFakeStateNotifier, makeStorage } from "@storyshelf/core/test-helpers";
import type { FakeStateNotifier } from "@storyshelf/core/test-helpers";
import AdmZip from "adm-zip";
/* oxlint-disable eslint/no-await-in-loop, eslint/no-promise-executor-return */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "./index.tsx";

const STORY_ID = "components-button--primary";
const SHA = "a".repeat(40);
const BASE = "https://shelf.example.com";

interface StatusCall {
  context: string;
  sha: string;
  state: string;
  url: string;
}

/** The commit statuses a fake git notifier was asked to show, in order. */
function statusCalls(git: FakeStateNotifier): StatusCall[] {
  return git.calls.flatMap((call) =>
    call.target.kind === "status"
      ? [{ context: call.target.context, sha: call.target.sha, state: call.state, url: call.url }]
      : [],
  );
}

/** The last state shown under each status name, once delivery has caught up with `wanted`. */
async function finalStates(
  git: FakeStateNotifier,
  wanted: Record<string, string>,
): Promise<Record<string, StatusCall>> {
  const latest = (): Record<string, StatusCall> =>
    Object.fromEntries(statusCalls(git).map((call) => [call.context, call]));
  await vi.waitFor(() => {
    const states = latest();
    expect(Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v.state]))).toEqual(
      wanted,
    );
  });
  return latest();
}

/** Add a git channel for the project through the notification-channel API. */
async function addGitChannel(
  app: ReturnType<typeof createShelfApp>,
  slug: string,
  channel: { provider: string; secret: string; prefix?: string },
): Promise<void> {
  const created = await app.request(`/api/v1/projects/${slug}/notification-channels`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: channel.provider,
      config: { owner: "acme", repo: "widgets", prefix: channel.prefix },
      secret: channel.secret,
    }),
  });
  expect(created.status).toBe(201);
}

function fakeRunner(overrides: Partial<CaptureRunner> = {}): {
  runner: CaptureRunner;
  render: ReturnType<typeof vi.fn>;
} {
  const metadata = {
    name: "Fake Runner",
    version: "0.0.0",
    kind: "fake",
    category: "capture-runner",
  } as const;
  const result: RenderResult = {
    captures: [
      {
        story: {
          id: STORY_ID,
          title: "Components/Button",
          name: "Primary",
          importPath: "./Button.stories.tsx",
          type: "story",
        },
        viewportName: "desktop",
        screenshot: Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.alloc(100),
        ]),
      },
    ],
    failures: [],
  };
  const render =
    overrides.render ??
    vi.fn(async () => {
      await Promise.resolve();
      return result;
    });
  const cancel =
    overrides.cancel ??
    vi.fn(async () => {
      await Promise.resolve();
    });
  return { runner: { metadata, render, cancel }, render: render as ReturnType<typeof vi.fn> };
}

function zipWithIndex(): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    "index.json",
    Buffer.from(
      JSON.stringify({
        v: 4,
        entries: {
          [STORY_ID]: {
            id: STORY_ID,
            name: "Primary",
            title: "Components/Button",
            importPath: "./Button.stories.tsx",
            type: "story",
          },
        },
      }),
    ),
  );
  return zip.toBuffer();
}

async function upTo(options: {
  app: ReturnType<typeof createShelfApp>;
  slug: string;
  buildId: string;
  wanted: string;
}): Promise<Build> {
  const { app, slug, buildId, wanted } = options;
  const deadline = Date.now() + 3000;
  for (;;) {
    const response = await app.request(`/api/v1/projects/${slug}/builds/${buildId}`);
    if (response.status !== 200) {
      throw new Error(`build fetch returned ${response.status}`);
    }
    const build = (await response.json()) as Build;
    if (build.status === wanted) {
      return build;
    }
    if (Date.now() > deadline) {
      throw new Error(`build did not reach "${wanted}"; last status "${build.status}"`);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-status-"));
});

afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

/** Create a build via JSON metadata and stream its zip with PUT. */
async function uploadBuild(
  app: ReturnType<typeof createShelfApp>,
  slug: string,
): Promise<{ id: string }> {
  const created = await app.request(`/api/v1/projects/${slug}/builds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gitSha: SHA, gitBranch: "main" }),
  });
  expect(created.status).toBe(202);
  const { build, uploadUrl } = (await created.json()) as {
    build: { id: string };
    uploadUrl: string;
  };
  const upload = await app.request(uploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/zip" },
    body: new Uint8Array(zipWithIndex()),
  });
  expect(upload.status).toBe(202);
  return build;
}

describe("git channel status fan-out", () => {
  it("posts pending and success statuses to every configured git channel", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const { runner } = fakeRunner();
    const gitA = makeFakeStateNotifier("github-a");
    const gitB = makeFakeStateNotifier("github-b");
    const app = createShelfApp({
      database: db,
      storage,
      testing: { runner, concurrency: 1 },
      config: { scratchDir, secret: "test-secret", purgeTtlDays: 30, publicBaseUrl: BASE },
      notifications: { notifiers: [gitA.provider, gitB.provider] },
      logger: pino({ level: "silent" }),
    });

    const projectResponse = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Fanout" }),
    });
    expect(projectResponse.status).toBe(201);
    const project = (await projectResponse.json()) as { id: string; slug: string };

    await addGitChannel(app, project.slug, { provider: "github-a", secret: "token-a" });
    await addGitChannel(app, project.slug, {
      provider: "github-b",
      secret: "token-b",
      prefix: "storyshelf-docs",
    });

    const createdBuild = await uploadBuild(app, project.slug);
    const updatedBuild = await upTo({
      app,
      slug: project.slug,
      buildId: createdBuild.id,
      wanted: "approved",
    });

    const url = `${BASE}/projects/${project.slug}/builds/${createdBuild.id}`;
    const storybook = `${BASE}/projects/${project.slug}/storybook/build/${createdBuild.id}/`;
    const a = await finalStates(gitA, {
      "storyshelf/testing": "success",
      "storyshelf/storybook": "success",
    });
    expect(a["storyshelf/testing"]).toMatchObject({ sha: SHA, url });
    expect(a["storyshelf/storybook"]).toMatchObject({ sha: SHA, url: storybook });
    const b = await finalStates(gitB, {
      "storyshelf-docs/testing": "success",
      "storyshelf-docs/storybook": "success",
    });
    expect(b["storyshelf-docs/testing"]).toMatchObject({ sha: SHA, url });
    expect(new Set(gitA.secrets)).toEqual(new Set(["token-a"]));
    expect(new Set(gitB.secrets)).toEqual(new Set(["token-b"]));
    expect(updatedBuild.status).toBe("approved");
  });

  it("posts failure when the capture renderer rejects", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const { runner } = fakeRunner({
      render: vi.fn(async () => {
        await Promise.resolve();
        throw new Error("browser exploded");
      }),
    });
    const gitA = makeFakeStateNotifier("github-a");
    const gitB = makeFakeStateNotifier("github-b");
    const app = createShelfApp({
      database: db,
      storage,
      testing: { runner, concurrency: 1 },
      config: { scratchDir, secret: "test-secret", purgeTtlDays: 30, publicBaseUrl: BASE },
      notifications: { notifiers: [gitA.provider, gitB.provider] },
      logger: pino({ level: "silent" }),
    });

    const projectResponse = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Fanout failure" }),
    });
    const project = (await projectResponse.json()) as { id: string; slug: string };
    await addGitChannel(app, project.slug, { provider: "github-a", secret: "token-a" });

    const createdBuild = await uploadBuild(app, project.slug);

    await upTo({ app, slug: project.slug, buildId: createdBuild.id, wanted: "failed" });

    const states = await finalStates(gitA, {
      "storyshelf/testing": "failure",
      "storyshelf/storybook": "success",
    });
    expect(states["storyshelf/testing"]).toMatchObject({ sha: SHA });
    expect(statusCalls(gitB)).toEqual([]);
  });

  it("shows a build that was never captured: only the Storybook status, once it is published", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const git = makeFakeStateNotifier("github-a");
    const app = createShelfApp({
      database: db,
      storage,
      config: { scratchDir, secret: "test-secret", publicBaseUrl: BASE },
      notifications: { notifiers: [git.provider] },
      logger: pino({ level: "silent" }),
    });
    const project = (await (
      await app.request("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Hosting only" }),
      })
    ).json()) as { id: string; slug: string };
    await addGitChannel(app, project.slug, { provider: "github-a", secret: "token-a" });

    const build = await uploadBuild(app, project.slug);

    const states = await finalStates(git, { "storyshelf/storybook": "success" });
    expect(states["storyshelf/storybook"]).toMatchObject({
      sha: SHA,
      url: `${BASE}/projects/${project.slug}/storybook/build/${build.id}/`,
    });
  });

  it("on a host with no consumer, delivers inline and shows a refused status as the channel's last error", async () => {
    vi.stubEnv("VERCEL", "1");
    try {
      const { db } = makeDatabase();
      const { storage } = makeStorage();
      const { runner } = fakeRunner();
      const failing = makeFakeStateNotifier("github-a", "HTTP 401: Bad credentials");
      const app = createShelfApp({
        database: db,
        storage,
        testing: { runner, concurrency: 1 },
        config: { scratchDir, secret: "test-secret", purgeTtlDays: 30, publicBaseUrl: BASE },
        notifications: { notifiers: [failing.provider] },
        logger: pino({ level: "silent" }),
      });
      const project = (await (
        await app.request("/api/v1/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Fanout health" }),
        })
      ).json()) as { id: string; slug: string };
      await addGitChannel(app, project.slug, { provider: "github-a", secret: "bad-token" });

      await uploadBuild(app, project.slug);

      await vi.waitFor(async () => {
        const list = await app.request(`/api/v1/projects/${project.slug}/notification-channels`);
        const [channel] = (await list.json()) as {
          lastError: string | null;
          lastErrorAt: string | null;
        }[];
        expect(channel?.lastError).toBe("HTTP 401: Bad credentials");
        expect(channel?.lastErrorAt).not.toBeNull();
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
