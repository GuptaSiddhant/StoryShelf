import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMcpInit } from "./init.ts";
import type { Prompter } from "./prompter.ts";

// oxlint-disable-next-line no-template-curly-in-string -- literal client-side env interpolation
const TOKEN_REF = "${SHELF_TOKEN}";
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "storyshelf-mcp-init-"));
  vi.stubGlobal("__PKG_VERSION__", "0.6.2");
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** A prompter that answers from `answers` by question; a missing answer cancels. */
function prompter(answers: Record<string, unknown>): Prompter {
  const byQuestion: Record<string, string> = {
    "Project name?": "name",
    "Directory?": "dir",
    "How will agents connect?": "transport",
    "StoryShelf server URL?": "url",
    "Default project slug?": "slug",
    "Add a Dockerfile (HTTP transport)?": "docker",
  };
  const answer = (message: string): never => (answers[byQuestion[message] ?? ""] ?? null) as never;
  return {
    text: async (message) => await Promise.resolve(answer(message)),
    select: async (message) => await Promise.resolve(answer(message)),
    confirm: async (message) => await Promise.resolve(answer(message)),
    close: () => {},
  };
}

async function init(answers: Record<string, unknown>): Promise<string> {
  const dir = join(tmpRoot, "my-mcp");
  await runMcpInit(
    {},
    {
      prompter: prompter({
        name: "my-mcp",
        dir,
        url: "https://shelf.test",
        slug: "web",
        ...answers,
      }),
      env: {},
    },
  );
  return dir;
}

describe("runMcpInit", () => {
  it("scaffolds a stdio project with a Claude Code config and no token", async () => {
    const dir = await init({ transport: "stdio", docker: false });
    const entry = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(entry).not.toContain(`import "@storyshelf/mcp"`);
    expect(entry).toContain("storyshelf-mcp");
    const config = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8")) as {
      mcpServers: { storyshelf: { command: string; env: Record<string, string> } };
    };
    expect(config.mcpServers.storyshelf.command).toBe("npx");
    expect(config.mcpServers.storyshelf.env["SHELF_TOKEN"]).toBe(TOKEN_REF);
    expect(readFileSync(join(dir, ".env.example"), "utf8")).toContain("SHELF_TOKEN=\n");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/mcp"]).toBeDefined();
    expect(pkg.scripts["start"]).toBe("storyshelf-mcp");
    expect(existsSync(join(dir, "Dockerfile"))).toBe(false);
  });

  it("scaffolds an http project with a Dockerfile", async () => {
    const dir = await init({ transport: "http", docker: true });
    expect(readFileSync(join(dir, "src", "index.ts"), "utf8")).toContain("serveHttp");
    expect(readFileSync(join(dir, "Dockerfile"), "utf8")).toContain("node:24-slim");
    expect(readFileSync(join(dir, ".mcp.json"), "utf8")).toContain("/mcp");
  });

  it("does nothing when cancelled", async () => {
    await runMcpInit({}, { prompter: prompter({}), env: {} });
    expect(existsSync(join(tmpRoot, "my-mcp"))).toBe(false);
  });
});
