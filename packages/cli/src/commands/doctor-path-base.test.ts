import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type Affected = typeof import("@storyshelf/affected");

async function actualOf(load: () => Promise<Affected>): Promise<Affected> {
  return load();
}

vi.mock("@storyshelf/affected", async (importOriginal: () => Promise<Affected>) => ({
  ...(await actualOf(importOriginal)),
  pathBase: (): null => null,
}));

const { runDoctor } = await import("./doctor.ts");

let dir = "";

afterEach(() => {
  vi.unstubAllGlobals();
  process.exitCode = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("runDoctor path base", () => {
  it("warns path-base-unknown when the project cannot be placed in its repository", async () => {
    const made = mkdtempSync(join(tmpdir(), "storyshelf-doctor-pb-"));
    dir = realpathSync(made);
    execFileSync("git", ["-c", "init.defaultBranch=main", "init"], { cwd: dir });
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(join(dir, ".storybook", "main.ts"), "export default {};\n");
    mkdirSync(join(dir, "storybook-static"), { recursive: true });
    writeFileSync(join(dir, "storybook-static", "index.json"), "{}");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync(
      "git",
      ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-m", "init"],
      { cwd: dir },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await Promise.resolve();
        return {
          ok: true,
          status: 200,
          text: async (): Promise<string> => "",
          json: async (): Promise<unknown> => ({ name: "Demo", slug: "demo" }),
        };
      }),
    );
    const lines: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string): boolean => {
      lines.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      await runDoctor({ url: "https://shelf.example.com", slug: "demo", token: "t", cwd: dir });
    } finally {
      process.stdout.write = write;
    }
    expect(lines.some((line) => line.includes("path-base-unknown"))).toBe(true);
  });
});
