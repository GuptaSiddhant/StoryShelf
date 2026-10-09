import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateTsconfig, SERVER_ENTRY, WORKER_ENTRY, writeScaffoldFile } from "./scaffold.ts";

let dir = "";
afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("scaffold helpers", () => {
  it("keeps entries under src/", () => {
    expect(SERVER_ENTRY).toBe("src/index.ts");
    expect(WORKER_ENTRY).toBe("src/worker.ts");
  });

  it("generates a strict, type-check-only tsconfig covering src", () => {
    const config = JSON.parse(generateTsconfig()) as {
      compilerOptions: Record<string, unknown>;
      include: string[];
    };
    expect(config.include).toEqual(["src"]);
    expect(config.compilerOptions["strict"]).toBe(true);
    expect(config.compilerOptions["noEmit"]).toBe(true);
    expect(config.compilerOptions["allowImportingTsExtensions"]).toBe(true);
    expect(config.compilerOptions["types"]).toEqual(["node"]);
  });

  it("writes nested files, creating parent directories", async () => {
    dir = mkdtempSync(join(tmpdir(), "storyshelf-scaffold-"));
    await writeScaffoldFile(dir, SERVER_ENTRY, "export {};\n");
    expect(readFileSync(join(dir, "src", "index.ts"), "utf8")).toBe("export {};\n");
  });
});
