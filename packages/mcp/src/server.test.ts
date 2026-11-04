import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
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

async function connect(api: ApiClient, testing = true): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createStoryShelfMcpServer(api, { testing }).connect(serverSide);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
  return client;
}

function text(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0]?.text ?? "";
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    expect(names.some((n) => /approve|reject|retry|generate|verdict|review_/u.test(n))).toBe(false);
    expect(tools.find((tool) => tool.name === "add_comment")?.annotations?.readOnlyHint).toBe(
      false,
    );
    expect(tools.find((tool) => tool.name === "get_build")?.annotations?.readOnlyHint).toBe(true);
  });

  it("advertises only hosting and review tools when the instance has no testing", async () => {
    const { tools } = await (await connect(fakeClient(), false)).listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("list_builds");
    expect(names).toContain("add_comment");
    expect(names).not.toContain("list_snapshots");
    expect(names).not.toContain("get_build_insight");
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

  it("returns whether accessibility checks run, and says so in the tool description", async () => {
    const get = vi
      .fn()
      .mockResolvedValue({ slug: "web", gitDefaultBranch: "main", runA11y: false });
    const client = await connect(fakeClient({ get }));
    const out = JSON.parse(text(await client.callTool({ name: "get_project", arguments: {} })));
    expect(get).toHaveBeenCalledWith("/projects/web");
    expect(out).toMatchObject({ runA11y: false });
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === "get_project")?.description).toContain("runA11y");
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

  it("posts a story comment", async () => {
    const post = vi.fn().mockResolvedValue({ id: "c2" });
    const client = await connect(fakeClient({ post }));
    await client.callTool({
      name: "add_comment",
      arguments: { buildId: "b1", body: "Focus ring?", storyId: "button--primary" },
    });
    expect(post).toHaveBeenCalledWith("/projects/web/builds/b1/comments", {
      body: "Focus ring?",
      storyId: "button--primary",
    });
  });

  it("lists comments with their scope, kind and state untouched, and writes nothing", async () => {
    const comments = [
      {
        id: "c1",
        buildId: "b1",
        snapshotId: null,
        storyId: null,
        kind: "comment",
        resolved: false,
      },
      { id: "c2", buildId: "b1", snapshotId: null, storyId: "button--primary", kind: "comment" },
      { id: "c3", buildId: "b1", snapshotId: "s1", storyId: null, parentId: "c1", resolved: true },
      { id: "c4", buildId: "b1", snapshotId: null, storyId: null, kind: "change_request" },
    ];
    const get = vi.fn().mockResolvedValue(comments);
    const post = vi.fn();
    const client = await connect(fakeClient({ get, post }), false);
    const out = JSON.parse(
      text(await client.callTool({ name: "list_comments", arguments: { buildId: "b1" } })),
    );
    expect(get).toHaveBeenCalledWith("/projects/web/builds/b1/comments");
    await client.callTool({
      name: "list_comments",
      arguments: { project: "other", buildId: "b1" },
    });
    expect(get).toHaveBeenCalledWith("/projects/other/builds/b1/comments");
    expect(out).toEqual(comments);
    expect(post).not.toHaveBeenCalled();
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === "list_comments")?.annotations?.readOnlyHint).toBe(
      true,
    );
  });

  it("says review is off, not that the build was not found, when the project has review off", async () => {
    const off = new ToolError(
      "StoryShelf API: not found: check the project slug and build id",
      404,
    );
    const get = vi.fn().mockImplementation(async (path: string) => {
      if (path === "/projects/web") {
        return await Promise.resolve({ slug: "web", reviewEnabled: false });
      }
      throw off;
    });
    const post = vi.fn().mockRejectedValue(off);
    const client = await connect(fakeClient({ get, post }));
    const calls = [
      { name: "list_comments", arguments: { buildId: "b1" } },
      { name: "add_comment", arguments: { buildId: "b1", body: "x" } },
      { name: "resolve_comment", arguments: { buildId: "b1", commentId: "c1" } },
    ];
    for (const result of await Promise.all(
      calls.map(async (call) => await client.callTool(call)),
    )) {
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("review is off for this project");
    }
  });

  it("still says not found for a wrong build id when review is on, and for non-review tools", async () => {
    const off = new ToolError(
      "StoryShelf API: not found: check the project slug and build id",
      404,
    );
    const get = vi.fn().mockImplementation(async (path: string) => {
      if (path === "/projects/web") {
        return await Promise.resolve({ slug: "web", reviewEnabled: true });
      }
      throw off;
    });
    const client = await connect(fakeClient({ get }));
    const comments = await client.callTool({
      name: "list_comments",
      arguments: { buildId: "nope" },
    });
    expect(text(comments)).toContain("not found");
    const build = await client.callTool({ name: "get_build", arguments: { buildId: "nope" } });
    expect(text(build)).toContain("not found");
    // get_build is not a review tool, so the project was not even asked about it.
    expect(get.mock.calls.filter(([path]) => path === "/projects/web")).toHaveLength(1);
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
    const body = JSON.stringify(prompt.messages);
    expect(body).toContain("b1");
    expect(body).toContain("list_snapshots");
  });

  it("leaves the capture tools out of the review-build prompt when there is no testing", async () => {
    const client = await connect(fakeClient(), false);
    const prompt = await client.getPrompt({ name: "review-build", arguments: { buildId: "b1" } });
    const body = JSON.stringify(prompt.messages);
    expect(body).toContain("get_build");
    for (const tool of ["list_snapshots", "get_build_insight", "get_capture_logs"]) {
      expect(body).not.toContain(tool);
    }
  });
});
