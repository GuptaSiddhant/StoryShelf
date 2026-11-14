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
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

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

  it("uploads normally when a story file was removed", async () => {
    affected([], ["src/gone.stories.tsx"]);
    const { client, createSkipped } = fakeClient({});
    await expect(trySkipUnchanged(client, ctx())).resolves.toBe(false);
    expect(createSkipped).not.toHaveBeenCalled();
    expect(lines[0]).toContain("removed or renamed");
  });

  it("still skips when a changed story file exists", async () => {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.stories.tsx"), "");
    affected([], ["src/a.stories.tsx"]);
    const { client } = fakeClient({});
    await expect(trySkipUnchanged(client, ctx())).resolves.toBe(true);
  });

  it("uploads normally when labels are given", async () => {
    const { client, skipSource } = fakeClient({});
    await expect(trySkipUnchanged(client, ctx({ label: ["pr=1"] }))).resolves.toBe(false);
    expect(skipSource).not.toHaveBeenCalled();
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
