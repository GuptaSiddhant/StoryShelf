import AdmZip from "adm-zip";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUpload, resolveIdentity, type GitIdentityProbe } from "./upload.ts";

let dir: string;

function baseOptions(): {
  url: string;
  slug: string;
  token: string;
  sha: string;
  branch: string;
  cwd: string;
} {
  return {
    url: "https://shelf.example.com",
    slug: "demo",
    token: "ci-token",
    sha: "abc123",
    branch: "main",
    cwd: dir,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-upload-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("runUpload validation", () => {
  function throwsWithout(field: string, partial: Record<string, string>, message: string): void {
    it(`throws without ${field}`, async () => {
      await expect(runUpload({ ...partial, cwd: dir })).rejects.toThrow(message);
    });
  }
  const cases: { field: string; partial: Record<string, string>; message: string }[] = [
    {
      field: "url",
      partial: { slug: "demo", token: "t", sha: "s", branch: "b" },
      message: "--url is required",
    },
    {
      field: "slug",
      partial: { url: "u", token: "t", sha: "s", branch: "b" },
      message: "--slug is required",
    },
    {
      field: "token",
      partial: { url: "u", slug: "s", sha: "s", branch: "b" },
      message: "--token is required",
    },
  ];
  for (const { field, partial, message } of cases) {
    throwsWithout(field, partial, message);
  }

  it("skips silently when the branch matches skip", async () => {
    const fetched = vi.fn(async (): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
      await Promise.resolve();
      return {
        ok: true,
        json: async (): Promise<unknown> => {
          await Promise.resolve();
          return { id: "b1" };
        },
      };
    });
    vi.stubGlobal("fetch", fetched);
    await runUpload({ ...baseOptions(), branch: "dependabot/npm", skip: "dependabot/*" });
    expect(fetched).not.toHaveBeenCalled();
  });
});

describe("runUpload success", () => {
  function writeFixture(): void {
    const buildDir = join(dir, "storybook-static");
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(join(buildDir, "index.json"), JSON.stringify({ v: 5, entries: {} }));
    writeFileSync(join(buildDir, "iframe.html"), "<html></html>");
  }

  it("posts JSON metadata then streams the zip with PUT", async () => {
    writeFixture();
    const calls: { method: string; url: string; contentType: string | null }[] = [];
    let putBytes: Buffer = Buffer.alloc(0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        await Promise.resolve();
        const headers = new Headers(init?.headers);
        calls.push({
          method: init?.method ?? "GET",
          url,
          contentType: headers.get("content-type"),
        });
        if ((init?.method ?? "") === "PUT") {
          putBytes = await collectBody(init?.body);
          return okJson({ id: "b1" });
        }
        return okJson({ build: { id: "b1" }, uploadUrl: "/api/v1/projects/demo/builds/b1/zip" });
      }),
    );

    await runUpload({ ...baseOptions(), buildDir: "storybook-static", label: ["pr=123"] });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ method: "POST", contentType: "application/json" });
    expect(calls[1]).toMatchObject({
      method: "PUT",
      url: "https://shelf.example.com/api/v1/projects/demo/builds/b1/zip",
      contentType: "application/zip",
    });
    const zip = new AdmZip(putBytes);
    expect(
      zip
        .getEntries()
        .map((entry) => entry.entryName)
        .toSorted(),
    ).toEqual(["iframe.html", "index.json"]);
  });

  it("throws on invalid --label flags", async () => {
    writeFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await Promise.resolve();
        return okJson({ build: { id: "b1" }, uploadUrl: "/x" });
      }),
    );
    await expect(runUpload({ ...baseOptions(), label: ["noequals"] })).rejects.toThrow(
      "--label must be key=value",
    );
  });
});

describe("runUpload dry run", () => {
  it("sends no requests and reports what would upload", async () => {
    const buildDir = join(dir, "storybook-static");
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(join(buildDir, "index.json"), "{}");
    const fetched = vi.fn(async () => {
      await Promise.resolve();
      return okJson({});
    });
    vi.stubGlobal("fetch", fetched);
    await runUpload({ ...baseOptions(), dryRun: true });
    expect(fetched).not.toHaveBeenCalled();
  });

  it("still runs the build step before reporting", async () => {
    const fetched = vi.fn(async () => {
      await Promise.resolve();
      return okJson({});
    });
    vi.stubGlobal("fetch", fetched);
    await expect(
      runUpload({
        ...baseOptions(),
        buildDir: "storybook-static",
        buildCommand: "exit 1",
        dryRun: true,
      }),
    ).rejects.toThrow();
    expect(fetched).not.toHaveBeenCalled();
  });
});

/** Collect a streamed request body into a buffer. */
async function collectBody(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as Readable) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

function okJson(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async (): Promise<string> => {
      await Promise.resolve();
      return "";
    },
    json: async (): Promise<unknown> => {
      await Promise.resolve();
      return payload;
    },
  } as Response;
}

describe("runUpload affected capture", () => {
  function git(args: string[]): string {
    return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  }

  function writeBuild(): void {
    const buildDir = join(dir, "storybook-static");
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(
      join(buildDir, "index.json"),
      JSON.stringify({
        v: 5,
        entries: {
          a: { id: "a", importPath: "src/a.stories.tsx" },
          b: { id: "b", importPath: "src/b.stories.tsx" },
        },
      }),
    );
    writeFileSync(
      join(buildDir, "preview-stats.json"),
      JSON.stringify({
        modules: [
          { id: "src/a.stories.tsx", importedIds: ["src/a.tsx"] },
          { id: "src/b.stories.tsx", importedIds: ["src/b.tsx"] },
        ],
      }),
    );
    writeFileSync(join(buildDir, "iframe.html"), "<html></html>");
  }

  function commitAll(message: string): void {
    git(["add", "."]);
    git(["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-m", message]);
  }

  interface SeenCall {
    method: string;
    url: string;
    body?: unknown;
  }

  function stubFetch(created: unknown): { calls: SeenCall[] } {
    const calls: SeenCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        await Promise.resolve();
        const method = init?.method ?? "GET";
        calls.push({ method, url });
        if (method === "POST" && typeof init?.body === "string") {
          calls[calls.length - 1]!.body = JSON.parse(init.body) as unknown;
        }
        if (method === "PUT") {
          return okJson({ id: "b1" });
        }
        if (url.endsWith("/affected")) {
          return okJson({ id: "b1" });
        }
        return okJson(created);
      }),
    );
    return { calls };
  }

  it("posts a full-capture computation outside a git repository", async () => {
    writeBuild();
    const { calls } = stubFetch({
      build: { id: "b1" },
      uploadUrl: "/x",
      baselineSha: "abc123",
    });

    await runUpload({ ...baseOptions(), buildDir: "storybook-static" });

    expect(calls.map((call) => call.method)).toEqual(["POST", "POST", "PUT"]);
    expect(calls[1]?.url).toContain("/builds/b1/affected");
    const body = calls[1]?.body as { affectedImportPaths: string[] | null };
    expect(body.affectedImportPaths).toBeNull();
  });

  it("posts the selective set for a git change", async () => {
    git(["-c", "init.defaultBranch=main", "init"]);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "a.tsx"), "v1");
    writeFileSync(join(dir, "src", "b.tsx"), "v1");
    writeBuild();
    commitAll("base");
    const base = git(["rev-parse", "HEAD"]);
    writeFileSync(join(dir, "src", "a.tsx"), "v2");
    commitAll("change a");
    const head = git(["rev-parse", "HEAD"]);
    const { calls } = stubFetch({
      build: { id: "b1" },
      uploadUrl: "/x",
      baselineSha: base,
    });

    await runUpload({ ...baseOptions(), sha: head, buildDir: "storybook-static" });

    const affected = calls.find((call) => call.url.endsWith("/affected"));
    expect(affected?.method).toBe("POST");
    expect(affected?.body).toMatchObject({
      baselineSha: base,
      affectedImportPaths: ["src/a.stories.tsx"],
    });
    expect(calls.some((call) => call.method === "PUT")).toBe(true);
  });

  it("skips the affected post when --full is set", async () => {
    writeBuild();
    const { calls } = stubFetch({
      build: { id: "b1" },
      uploadUrl: "/x",
      baselineSha: "abc123",
    });

    await runUpload({ ...baseOptions(), buildDir: "storybook-static", full: true });

    expect(calls.map((call) => call.method)).toEqual(["POST", "PUT"]);
  });

  it("merges config-file and flag untraced globs", async () => {
    git(["-c", "init.defaultBranch=main", "init"]);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "a.tsx"), "v1");
    writeFileSync(join(dir, "src", "b.tsx"), "v1");
    writeBuild();
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "demo", affected: { untraced: ["src/a.tsx"] } }),
    );
    commitAll("base");
    const base = git(["rev-parse", "HEAD"]);
    writeFileSync(join(dir, "src", "a.tsx"), "v2");
    writeFileSync(join(dir, "src", "b.tsx"), "v2");
    commitAll("change both");
    const head = git(["rev-parse", "HEAD"]);
    const { calls } = stubFetch({
      build: { id: "b1" },
      uploadUrl: "/x",
      baselineSha: base,
    });

    await runUpload({
      url: "https://shelf.example.com",
      token: "ci-token",
      sha: head,
      buildDir: "storybook-static",
      untraced: ["src/b.tsx"],
      cwd: dir,
    });

    const affected = calls.find((call) => call.url.endsWith("/affected"));
    expect(affected?.body).toMatchObject({
      baselineSha: base,
      changedFiles: ["src/a.tsx", "src/b.tsx"],
      affectedImportPaths: [],
    });
  });

  it("synthesizes a local identity outside a git repository", async () => {
    writeBuild();
    const { calls } = stubFetch({
      build: { id: "b1" },
      uploadUrl: "/x",
      baselineSha: null,
    });
    const { sha: _sha, branch: _branch, ...rest } = baseOptions();

    await runUpload({ ...rest, buildDir: "storybook-static" });

    const created = calls[0]?.body as { gitSha: string; gitBranch: string };
    expect(created.gitSha.startsWith("local-")).toBe(true);
    expect(created.gitBranch).toBe("local");
  });
});

describe("resolveIdentity", () => {
  const nullProbe: GitIdentityProbe = {
    headSha: () => null,
    branchName: () => null,
  };

  it("prefers flags over everything", () => {
    vi.stubEnv("GITHUB_SHA", "env-sha");
    vi.stubEnv("GITHUB_REF_NAME", "env-branch");
    const probe: GitIdentityProbe = {
      headSha: () => "git-sha",
      branchName: () => "git-branch",
    };
    expect(resolveIdentity(dir, { sha: "flag-sha", branch: "flag-branch" }, probe)).toEqual({
      sha: "flag-sha",
      branch: "flag-branch",
      synthesized: false,
    });
  });

  it("falls back to env, then git, then synthesis per field", () => {
    vi.stubEnv("GITHUB_SHA", "env-sha");
    const probe: GitIdentityProbe = {
      headSha: () => "git-sha",
      branchName: () => "git-branch",
    };
    expect(resolveIdentity(dir, {}, probe)).toEqual({
      sha: "env-sha",
      branch: "git-branch",
      synthesized: true,
    });
  });

  it("synthesizes a unique local identity without git", () => {
    const first = resolveIdentity(dir, {}, nullProbe);
    const second = resolveIdentity(dir, {}, nullProbe);
    expect(first.sha.startsWith("local-")).toBe(true);
    expect(first.branch).toBe("local");
    expect(first.synthesized).toBe(true);
    expect(first.sha).not.toBe(second.sha);
  });
});
