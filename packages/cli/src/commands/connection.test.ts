import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConnection } from "./connection.ts";
import { resetTokenFlagWarning } from "./token-flag.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-connection-"));
  mkdirSync(join(dir, ".storybook"));
  writeFileSync(
    join(dir, ".storybook", "storyshelf.json"),
    JSON.stringify({ slug: "from-config", url: "https://config.example" }),
  );
  vi.stubEnv("SHELF_TOKEN", "env-token");
  resetTokenFlagWarning();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveConnection precedence", () => {
  it("takes the config file when no flag or env is set", async () => {
    vi.stubEnv("SHELF_URL", "");
    vi.stubEnv("SHELF_SLUG", "");
    const connection = await resolveConnection({ cwd: dir });
    expect(connection).toEqual({
      url: "https://config.example",
      slug: "from-config",
      token: "env-token",
    });
  });

  it("prefers SHELF_* env over the config file, and flags over env", async () => {
    vi.stubEnv("SHELF_URL", "https://env.example");
    vi.stubEnv("SHELF_SLUG", "from-env");
    expect(await resolveConnection({ cwd: dir })).toMatchObject({
      url: "https://env.example",
      slug: "from-env",
    });
    expect(
      await resolveConnection({ cwd: dir, url: "https://flag.example", slug: "from-flag" }),
    ).toMatchObject({ url: "https://flag.example", slug: "from-flag" });
  });

  it("warns once on --token without printing it", async () => {
    let written = "";
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written += String(chunk);
      return true;
    });
    await resolveConnection({ cwd: dir, token: "flag-secret" });
    expect(written).toContain("--token");
    expect(written).not.toContain("flag-secret");
  });
});
