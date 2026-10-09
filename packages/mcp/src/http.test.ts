import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpHttpHandler, serveHttp } from "./http.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "t", version: "0" },
  },
};

function post(headers: Record<string, string>): Request {
  return new Request("http://mcp.test/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(INIT),
  });
}

describe("createMcpHttpHandler", () => {
  const handler = createMcpHttpHandler({ url: "https://s.example", slug: "web" });

  it("401s without a bearer token", async () => {
    const response = await handler(post({}));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("rejects browser origins that are not allowed", async () => {
    const response = await handler(
      post({ authorization: "Bearer t", origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
  });

  it("initializes with a token", async () => {
    const response = await handler(post({ authorization: "Bearer t" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("storyshelf");
  });
});

describe("serveHttp", () => {
  it("forwards the caller's token upstream on a tool call", async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json([{ id: "b1", status: "approved" }]));
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
      (input instanceof Request ? input.url : input.toString()).startsWith("https://s.example")
        ? upstream(input, init)
        : realFetch(input, init),
    );
    const server = await serveHttp({ url: "https://s.example", slug: "web", port: 0 });
    const address = server.address() as { port: number };
    const client = new Client({ name: "t", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
        requestInit: { headers: { authorization: "Bearer caller-token" } },
      }),
    );
    const result = await client.callTool({ name: "list_builds", arguments: {} });
    expect(JSON.stringify(result)).toContain("b1");
    const [url, init] = upstream.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://s.example/api/v1/projects/web/builds");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer caller-token");
    await client.close();
    server.close();
  });
});
