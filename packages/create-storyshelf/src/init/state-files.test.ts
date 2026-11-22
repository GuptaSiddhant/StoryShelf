import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STATE_GITIGNORE, STATE_WARNING, writeStateGitignore } from "./state-files.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "storyshelf-state-files-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The lines of the `.gitignore` in `root`. */
function ignored(): string[] {
  return readFileSync(join(root, ".gitignore"), "utf8").trimEnd().split("\n");
}

describe("writeStateGitignore", () => {
  it("writes the state, the provider cache and the plan", async () => {
    await writeStateGitignore(join(root, ".gitignore"));
    expect(ignored()).toEqual(["*.tfstate*", ".terraform/", "tfplan"]);
  });

  it("adds only the missing entries to an existing file, keeping its lines", async () => {
    writeFileSync(join(root, ".gitignore"), "node_modules\ntfplan");
    await writeStateGitignore(join(root, ".gitignore"));
    expect(ignored()).toEqual(["node_modules", "tfplan", "*.tfstate*", ".terraform/"]);
  });

  it("leaves a file that already ignores everything untouched", async () => {
    const complete = `${STATE_GITIGNORE.join("\r\n")}\r\n`;
    writeFileSync(join(root, ".gitignore"), complete);
    await writeStateGitignore(join(root, ".gitignore"));
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(complete);
  });
});

describe("STATE_WARNING", () => {
  it("says the state holds secrets and belongs in an encrypted remote backend", () => {
    expect(STATE_WARNING).toMatch(/secrets/u);
    expect(STATE_WARNING).toMatch(/encrypted remote backend/u);
  });
});
