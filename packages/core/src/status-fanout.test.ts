import AdmZip from "adm-zip";
/* oxlint-disable eslint/no-await-in-loop, eslint/no-promise-executor-return */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino, type Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { CaptureRunner, RenderResult } from "./adapters/capture-runner.ts";
import type { CheckStatus, GitHostAdapter, GitHostProvider } from "./adapters/git-host/index.ts";
import { makeDatabase, makeStorage } from "./capture/fake-adapters.ts";
import { createShelfRouter } from "./index.tsx";
import type { Build } from "./schema.ts";

const STORY_ID = "components-button--primary";
const SHA = "a".repeat(40);

interface StatusCall {
  context: string;
  gitSha: string;
  status: CheckStatus;
  url: string;
}

function fakeRunner(overrides: Partial<CaptureRunner> = {}): {
  runner: CaptureRunner;
  render: ReturnType<typeof vi.fn>;
} {
  const metadata = { name: "Fake Runner", version: "0.0.0", kind: "fake" } as const;
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
        screenshot: Buffer.from([0, 1, 2]),
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

function fakeGitProvider(key: string, calls: StatusCall[], tokens: string[]): GitHostProvider {
  const configSchema = z.object({ owner: z.string().min(1), repo: z.string().min(1) });
  const base: GitHostProvider = {
    metadata: {
      name: `Fake ${key}`,
      version: "0.0.0",
      kind: key,
      schema: configSchema,
    },
    create(opts: { config: unknown; token: string; logger?: Logger }): GitHostAdapter {
      return {
        metadata: base.metadata,
        setStatus: async (statusOpts: {
          context: string;
          gitSha: string;
          status: CheckStatus;
          url: string;
        }): Promise<void> => {
          calls.push({
            context: statusOpts.context,
            gitSha: statusOpts.gitSha,
            status: statusOpts.status,
            url: statusOpts.url,
          });
          tokens.push(opts.token);
          await Promise.resolve();
        },
      };
    },
  };
  return base;
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
  app: ReturnType<typeof createShelfRouter>;
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

describe("status provider fanout", () => {
  it("posts pending and success statuses to every configured provider", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const { runner } = fakeRunner();
    const callsA: StatusCall[] = [];
    const callsB: StatusCall[] = [];
    const tokensA: string[] = [];
    const tokensB: string[] = [];
    const app = createShelfRouter({
      database: db,
      storage,
      captureRunner: runner,
      config: { captureConcurrency: 1, scratchDir, secret: "test-secret", purgeTtlDays: 30 },
      gitHosts: [
        fakeGitProvider("github-a", callsA, tokensA),
        fakeGitProvider("github-b", callsB, tokensB),
      ],
      logger: pino({ level: "silent" }),
    });

    const projectResponse = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Fanout" }),
    });
    expect(projectResponse.status).toBe(201);
    const project = (await projectResponse.json()) as { id: string; slug: string };

    for (const [provider, token] of [
      ["github-a", "token-a"],
      ["github-b", "token-b"],
    ] as const) {
      const created = await app.request(`/api/v1/projects/${project.slug}/status-configs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, config: { owner: "acme", repo: "widgets" }, token }),
      });
      expect(created.status).toBe(201);
    }

    const zip = zipWithIndex();
    const form = new FormData();
    form.set("gitSha", SHA);
    form.set("gitBranch", "main");
    form.set("zip", new Blob([new Uint8Array(zip)], { type: "application/zip" }), "storybook.zip");
    const upload = await app.request(`/api/v1/projects/${project.slug}/builds`, {
      method: "POST",
      body: form,
    });
    expect(upload.status).toBe(202);
    const createdBuild = (await upload.json()) as Build;
    const updatedBuild = await upTo({
      app,
      slug: project.slug,
      buildId: createdBuild.id,
      wanted: "approved",
    });

    const expected: StatusCall[] = [
      {
        context: `storyshelf/${project.slug}`,
        gitSha: SHA,
        status: "pending",
        url: `/projects/${project.slug}/builds/${createdBuild.id}`,
      },
      {
        context: `storyshelf/${project.slug}`,
        gitSha: SHA,
        status: "success",
        url: `/projects/${project.slug}/builds/${createdBuild.id}`,
      },
    ];
    expect(callsA).toEqual(expected);
    expect(callsB).toEqual(expected);
    expect(tokensA.every((token) => token === "token-a")).toBe(true);
    expect(tokensB.every((token) => token === "token-b")).toBe(true);
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
    const callsA: StatusCall[] = [];
    const callsB: StatusCall[] = [];
    const tokensA: string[] = [];
    const tokensB: string[] = [];
    const app = createShelfRouter({
      database: db,
      storage,
      captureRunner: runner,
      config: { captureConcurrency: 1, scratchDir, secret: "test-secret", purgeTtlDays: 30 },
      gitHosts: [
        fakeGitProvider("github-a", callsA, tokensA),
        fakeGitProvider("github-b", callsB, tokensB),
      ],
      logger: pino({ level: "silent" }),
    });

    const projectResponse = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Fanout failure" }),
    });
    const project = (await projectResponse.json()) as { id: string; slug: string };

    const created = await app.request(`/api/v1/projects/${project.slug}/status-configs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "github-a",
        config: { owner: "acme", repo: "widgets" },
        token: "token-a",
      }),
    });
    expect(created.status).toBe(201);

    const zip = zipWithIndex();
    const form = new FormData();
    form.set("gitSha", SHA);
    form.set("gitBranch", "main");
    form.set("zip", new Blob([new Uint8Array(zip)], { type: "application/zip" }), "storybook.zip");
    const upload = await app.request(`/api/v1/projects/${project.slug}/builds`, {
      method: "POST",
      body: form,
    });
    expect(upload.status).toBe(202);
    const createdBuild = (await upload.json()) as Build;

    await upTo({ app, slug: project.slug, buildId: createdBuild.id, wanted: "failed" });

    expect(callsA).toEqual([
      expect.objectContaining({
        context: `storyshelf/${project.slug}`,
        gitSha: SHA,
        status: "pending" as const,
      }),
      expect.objectContaining({
        context: `storyshelf/${project.slug}`,
        gitSha: SHA,
        status: "failure" as const,
      }),
    ]);
    expect(callsB).toEqual([]);
    expect(tokensA.every((token) => token === "token-a")).toBe(true);
  });
});
