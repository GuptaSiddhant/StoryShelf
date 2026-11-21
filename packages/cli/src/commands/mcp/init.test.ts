import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("prompts", () => ({ default: vi.fn() }));

import prompts from "prompts";
import { runMcpInit } from "./init.ts";

// oxlint-disable-next-line no-template-curly-in-string -- literal client-side env interpolation
const TOKEN_REF = "${SHELF_TOKEN}";
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "storyshelf-mcp-init-"));
  vi.mocked(prompts).mockReset();
  vi.stubGlobal("__PKG_VERSION__", "0.6.2");
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(tmpRoot, { recursive: true, force: true });
});

async function init(answers: Record<string, unknown>): Promise<string> {
  const dir = join(tmpRoot, "my-mcp");
  vi.mocked(prompts).mockResolvedValue({
    name: "my-mcp",
    dir,
    url: "https://shelf.test",
    slug: "web",
    ...answers,
  });
  await runMcpInit({});
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
    vi.mocked(prompts).mockResolvedValue({});
    await runMcpInit({});
    expect(existsSync(join(tmpRoot, "my-mcp"))).toBe(false);
  });
});
