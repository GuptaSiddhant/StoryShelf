import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { resolveConnection } from "./connection.ts";
import { runDoctor } from "./doctor.ts";

let dir: string;
let savedExitCode: typeof process.exitCode;

function mockFetch(handler: (url: string, init?: RequestInit) => unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      return {
        ok: true,
        status: 200,
        text: async (): Promise<string> => {
          await Promise.resolve();
          return "";
        },
        json: async (): Promise<unknown> => {
          await Promise.resolve();
          return handler(url, init);
        },
      };
    }),
  );
}

function setupStorybook(): void {
  mkdirSync(join(dir, ".storybook"), { recursive: true });
  writeFileSync(join(dir, ".storybook", "main.ts"), "export default {};\n");
}

function seedValidOutput(): void {
  const outDir = join(dir, "storybook-static");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "index.json"), "{}");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-doctor-"));
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveConnection", () => {
  it("throws without a url", async () => {
    await expect(resolveConnection({ slug: "demo", token: "t", cwd: dir })).rejects.toThrow(
      "--url is required",
    );
  });

  it("throws without a slug", async () => {
    await expect(
      resolveConnection({ url: "https://shelf.example.com", token: "t", cwd: dir }),
    ).rejects.toThrow("--slug is required");
  });

  it("throws without a token", async () => {
    await expect(
      resolveConnection({ url: "https://shelf.example.com", slug: "demo", cwd: dir }),
    ).rejects.toThrow("--token is required");
  });

  it("resolves flags over the config file", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "file-slug", url: "https://file.example.com" }),
    );
    await expect(
      resolveConnection({ url: "https://flag.example.com", slug: "demo", token: "t", cwd: dir }),
    ).resolves.toEqual({
      url: "https://flag.example.com",
      slug: "demo",
      token: "t",
    });
  });
});

describe("resolveConnection url", () => {
  const withSlash = "https://shelf.example.com/";
  const clean = "https://shelf.example.com";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("drops a trailing slash from the flag", async () => {
    const resolved = await resolveConnection({
      url: withSlash,
      slug: "demo",
      token: "t",
      cwd: dir,
    });
    expect(resolved.url).toBe(clean);
  });

  it("drops a trailing slash from the environment", async () => {
    vi.stubEnv("STORYSHELF_URL", `${withSlash}//`);
    const resolved = await resolveConnection({ slug: "demo", token: "t", cwd: dir });
    expect(resolved.url).toBe(clean);
  });

  it("drops a trailing slash from the config file and keeps a path prefix", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "demo", url: "https://shelf.example.com/shelf/" }),
    );
    const resolved = await resolveConnection({ token: "t", cwd: dir });
    expect(resolved.url).toBe("https://shelf.example.com/shelf");
  });
});

describe("runDoctor", () => {
  it("passes everything when setup, server, and output are ready", async () => {
    setupStorybook();
    seedValidOutput();
    mockFetch(() => ({ name: "Demo", slug: "demo" }));
    await runDoctor({
      url: "https://shelf.example.com",
      slug: "demo",
      token: "ci-token",
      cwd: dir,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("fails when storybook setup is missing", async () => {
    seedValidOutput();
    mockFetch(() => ({ slug: "demo" }));
    await runDoctor({
      url: "https://shelf.example.com",
      slug: "demo",
      token: "ci-token",
      cwd: dir,
    });
    expect(process.exitCode).toBe(1);
  });

  it("fails when connection details are missing", async () => {
    setupStorybook();
    seedValidOutput();
    await runDoctor({ cwd: dir });
    expect(process.exitCode).toBe(1);
  });

  it("fails when the server rejects the token", async () => {
    setupStorybook();
    seedValidOutput();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await Promise.resolve();
        return {
          ok: false,
          status: 403,
          text: async (): Promise<string> => {
            await Promise.resolve();
            return "forbidden";
          },
          json: async (): Promise<unknown> => {
            await Promise.resolve();
            return {};
          },
        };
      }),
    );
    await runDoctor({
      url: "https://shelf.example.com",
      slug: "demo",
      token: "bad",
      cwd: dir,
    });
    expect(process.exitCode).toBe(1);
  });

  it("warns but passes when the build output is missing", async () => {
    setupStorybook();
    mockFetch(() => ({ slug: "demo" }));
    await runDoctor({
      url: "https://shelf.example.com",
      slug: "demo",
      token: "ci-token",
      cwd: dir,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("fails when the build output lacks index.json", async () => {
    setupStorybook();
    mkdirSync(join(dir, "storybook-static"), { recursive: true });
    writeFileSync(join(dir, "storybook-static", "other.txt"), "x");
    mockFetch(() => ({ slug: "demo" }));
    await runDoctor({
      url: "https://shelf.example.com",
      slug: "demo",
      token: "ci-token",
      cwd: dir,
    });
    expect(process.exitCode).toBe(1);
  });

  it("warns about synthetic identity without git", async () => {
    setupStorybook();
    seedValidOutput();
    mockFetch(() => ({ name: "Demo", slug: "demo" }));
    const lines: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string): boolean => {
      lines.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      await runDoctor({
        url: "https://shelf.example.com",
        slug: "demo",
        token: "ci-token",
        cwd: dir,
      });
    } finally {
      process.stdout.write = write;
    }
    expect(lines.some((line) => line.includes("No git repository"))).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it("reports the project root and repository root affected capture will use", async () => {
    const repo = realpathSync(dir);
    const git = (args: string[]): string =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8" });
    git(["-c", "init.defaultBranch=main", "init"]);
    const project = join(repo, "packages", "app");
    mkdirSync(join(project, ".storybook"), { recursive: true });
    writeFileSync(join(project, ".storybook", "main.ts"), "export default {};\n");
    mkdirSync(join(project, "storybook-static"), { recursive: true });
    writeFileSync(join(project, "storybook-static", "index.json"), "{}");
    writeFileSync(join(project, "storybook-static", "preview-stats.json"), "{}");
    git(["add", "."]);
    git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-m", "init"]);
    mockFetch(() => ({ name: "Demo", slug: "demo" }));
    const lines: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string): boolean => {
      lines.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      await runDoctor({
        url: "https://shelf.example.com",
        slug: "demo",
        token: "ci-token",
        cwd: project,
      });
    } finally {
      process.stdout.write = write;
    }
    const ready = lines.find((line) => line.includes("Affected capture ready")) ?? "";
    expect(ready).toContain(`Storybook project ${project}`);
    expect(ready).toContain(`repository root ${repo}`);
    expect(process.exitCode).toBeUndefined();
  });
});
