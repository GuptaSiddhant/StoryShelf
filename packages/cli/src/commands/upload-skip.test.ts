import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestError, type createClient } from "../client.ts";
import { trySkipUnchanged, type SkipContext } from "./upload-skip.ts";

const computeAffected = vi.hoisted(() => vi.fn());
vi.mock("@storyshelf/affected", () => ({ computeAffected, gitRepoRoot: (cwd: string) => cwd }));

type Client = ReturnType<typeof createClient>;

let dir: string;
let lines: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-skip-"));
  lines = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk).trimEnd());
    return true;
  });
  computeAffected.mockReset();
  writeIndex({
    v: 5,
    entries: {
      "a--one": { id: "a--one", title: "A", name: "One", type: "story" },
      "a--docs": { id: "a--docs", title: "A", name: "Docs", type: "docs" },
      "a--test": { id: "a--test", title: "A", name: "T", type: "story", subtype: "test" },
      "no-title": { id: "no-title" },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function writeIndex(document: unknown, name = "index.json"): void {
  mkdirSync(join(dir, "storybook-static"), { recursive: true });
  writeFileSync(join(dir, "storybook-static", name), JSON.stringify(document));
}

function ctx(extra: Partial<SkipContext> = {}): SkipContext {
  return {
    slug: "demo",
    sha: "headsha1234567",
    branch: "main",
    cwd: dir,
    buildDir: "storybook-static",
    untraced: [],
    ...extra,
  };
}

function fakeClient(overrides: {
  skipSource?: () => Promise<unknown>;
  createSkipped?: () => Promise<unknown>;
}): {
  client: Client;
  skipSource: ReturnType<typeof vi.fn>;
  createSkipped: ReturnType<typeof vi.fn>;
} {
  const skipSource = vi.fn(
    overrides.skipSource ?? (async () => ({ sourceBuildId: "b0", sha: "basesha1234567" })),
  );
  const createSkipped = vi.fn(
    overrides.createSkipped ?? (async () => ({ build: { id: "b9" }, buildUrl: "/x" })),
  );
  const client = { projects: { builds: { skipSource, createSkipped } } } as unknown as Client;
  return { client, skipSource, createSkipped };
}

function affected(paths: string[] | null, changed: string[] = [], reason: string | null = null) {
  computeAffected.mockResolvedValue({
    affectedImportPaths: paths,
    changedFiles: changed,
    baselineSha: "basesha1234567",
    fullReason: reason,
  });
}

describe("trySkipUnchanged", () => {
  it("creates a skipped build when nothing is affected", async () => {
    affected([], ["README.md"]);
    const { client, createSkipped } = fakeClient({});
    await expect(
      trySkipUnchanged(client, ctx({ message: "docs", authorEmail: "a@b.c" })),
    ).resolves.toBe(true);
    expect(createSkipped).toHaveBeenCalledWith("demo", {
      gitSha: "headsha1234567",
      gitBranch: "main",
      sourceBuildId: "b0",
      changedFiles: ["README.md"],
      entryIds: ["a--one", "a--docs"],
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      labels: [],
      message: "docs",
      author: { email: "a@b.c", name: undefined },
    });
    expect(lines).toEqual(["Skipped: no story changed since basesha (build b9)"]);
  });

  it("uploads normally when the hint is null", async () => {
    const { client, createSkipped } = fakeClient({ skipSource: async () => null });
    await expect(trySkipUnchanged(client, ctx())).resolves.toBe(false);
    expect(computeAffected).not.toHaveBeenCalled();
    expect(createSkipped).not.toHaveBeenCalled();
    expect(lines[0]).toContain("no earlier approved build");
  });

  it("uploads normally with a full-capture reason", async () => {
    affected(null, [], "shallow-clone");
    const { client, createSkipped } = fakeClient({});
    await expect(trySkipUnchanged(client, ctx())).resolves.toBe(false);
    expect(createSkipped).not.toHaveBeenCalled();
    expect(lines[0]).toContain("shallow-clone");
  });

  it("uploads normally when stories are affected", async () => {
    affected(["src/a.stories.tsx"], ["src/a.tsx"]);
    const { client, createSkipped } = fakeClient({});
    await expect(trySkipUnchanged(client, ctx())).resolves.toBe(false);
    expect(createSkipped).not.toHaveBeenCalled();
    expect(lines[0]).toContain("1 affected stories");
  });

  it("sends labels, including persistent", async () => {
    affected([], ["README.md"]);
    const { client, createSkipped } = fakeClient({});
    await expect(
      trySkipUnchanged(client, ctx({ label: ["persistent=true", "pr=a=b"] })),
    ).resolves.toBe(true);
    expect(createSkipped.mock.calls[0]?.[1]).toMatchObject({
      labels: [
        { key: "persistent", value: "true" },
        { key: "pr", value: "a=b" },
      ],
    });
  });

  it("reads stories.json when there is no index.json", async () => {
    rmSync(join(dir, "storybook-static", "index.json"));
    writeIndex({ stories: { "b--x": { id: "b--x", kind: "B", story: "X" } } }, "stories.json");
    affected([], []);
    const { client, createSkipped } = fakeClient({});
    await expect(trySkipUnchanged(client, ctx())).resolves.toBe(true);
    expect(createSkipped.mock.calls[0]?.[1]).toMatchObject({ entryIds: ["b--x"] });
  });

  it("uploads normally when the index cannot be read", async () => {
    rmSync(join(dir, "storybook-static", "index.json"));
    affected([], []);
    const { client, createSkipped } = fakeClient({});
    await expect(trySkipUnchanged(client, ctx())).resolves.toBe(false);
    expect(createSkipped).not.toHaveBeenCalled();
    expect(lines[0]).toContain("index could not be read");
  });

  it("retries a network failure with the same key, and stops at the third attempt", async () => {
    affected([], []);
    let calls = 0;
    const { client, createSkipped } = fakeClient({
      createSkipped: async () => {
        calls += 1;
        if (calls < 3) throw new TypeError("fetch failed");
        return { build: { id: "b9" }, buildUrl: "/x" };
      },
    });
    await expect(trySkipUnchanged(client, ctx())).resolves.toBe(true);
    const keys = createSkipped.mock.calls.map(
      (call) => (call[1] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);

    const failing = fakeClient({
      createSkipped: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(trySkipUnchanged(failing.client, ctx())).resolves.toBe(false);
    expect(failing.createSkipped).toHaveBeenCalledTimes(3);
  });

  it("does not retry a refusal", async () => {
    affected([], []);
    const { client, createSkipped } = fakeClient({
      createSkipped: async () => {
        throw new RequestError(409, "stories differ");
      },
    });
    await expect(trySkipUnchanged(client, ctx())).resolves.toBe(false);
    expect(createSkipped).toHaveBeenCalledTimes(1);
  });

  it("uploads normally when the server refuses with 409", async () => {
    affected([], []);
    const { client } = fakeClient({
      createSkipped: async () => {
        throw new RequestError(409, "source moved");
      },
    });
    await expect(trySkipUnchanged(client, ctx())).resolves.toBe(false);
    expect(lines[0]).toContain("409");
  });

  it("uploads normally when the hint request fails", async () => {
    const { client } = fakeClient({
      skipSource: async () => {
        throw new RequestError(404, "not enabled");
      },
    });
    await expect(trySkipUnchanged(client, ctx())).resolves.toBe(false);
    expect(lines[0]).toContain("skip check failed");
  });

  it("reports a non-Error failure", async () => {
    const { client } = fakeClient({
      skipSource: vi.fn().mockRejectedValue("boom") as () => Promise<unknown>,
    });
    await expect(trySkipUnchanged(client, ctx())).resolves.toBe(false);
    expect(lines[0]).toContain("boom");
  });
});
