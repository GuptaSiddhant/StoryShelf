import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { ToolError, type ApiClient } from "./client.ts";
import { createStoryShelfMcpServer } from "./server.ts";

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    defaultSlug: "web",
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn().mockResolvedValue({ id: "c1" }),
    ...overrides,
  };
}

async function connect(api: ApiClient): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createStoryShelfMcpServer(api).connect(serverSide);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
  return client;
}

function text(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0]?.text ?? "";
}

describe("StoryShelf MCP server", () => {
  it("lists the v1 tools and exposes no approval tool", async () => {
    const client = await connect(fakeClient());
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_builds",
        "get_build",
        "list_snapshots",
        "get_build_insight",
        "get_project_health",
        "add_comment",
      ]),
    );
    expect(names.some((n) => /approve|reject|retry|generate/u.test(n))).toBe(false);
    expect(tools.find((tool) => tool.name === "add_comment")?.annotations?.readOnlyHint).toBe(
      false,
    );
    expect(tools.find((tool) => tool.name === "get_build")?.annotations?.readOnlyHint).toBe(true);
  });

  it("hides unchanged snapshots by default and trims fields", async () => {
    const get = vi.fn().mockResolvedValue([
      { id: "1", status: "unchanged", screenshotPath: "p" },
      { id: "2", status: "changed", screenshotPath: "p", diffRatio: 0.2 },
    ]);
    const client = await connect(fakeClient({ get }));
    const out = JSON.parse(
      text(await client.callTool({ name: "list_snapshots", arguments: { buildId: "b1" } })),
    );
    expect(get).toHaveBeenCalledWith("/projects/web/builds/b1/snapshots");
    expect(out.total).toBe(2);
    expect(out.snapshots).toHaveLength(1);
    expect(out.snapshots[0]).not.toHaveProperty("screenshotPath");
  });

  it("posts a comment", async () => {
    const post = vi.fn().mockResolvedValue({ id: "c1" });
    const client = await connect(fakeClient({ post }));
    await client.callTool({
      name: "add_comment",
      arguments: { buildId: "b1", body: "LGTM", snapshotId: "s1" },
    });
    expect(post).toHaveBeenCalledWith("/projects/web/builds/b1/comments", {
      body: "LGTM",
      snapshotId: "s1",
    });
  });

  it("returns ToolError text as an error result", async () => {
    const get = vi.fn().mockRejectedValue(new ToolError("StoryShelf API: not found"));
    const client = await connect(fakeClient({ get }));
    const result = await client.callTool({ name: "get_build", arguments: { buildId: "nope" } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not found");
  });

  it("asks for a project when there is no default", async () => {
    const client = await connect(fakeClient({ defaultSlug: undefined }));
    const result = await client.callTool({ name: "list_builds", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("No project");
  });

  it("offers the review-build prompt", async () => {
    const client = await connect(fakeClient());
    const prompt = await client.getPrompt({ name: "review-build", arguments: { buildId: "b1" } });
    expect(JSON.stringify(prompt.messages)).toContain("b1");
  });
});
