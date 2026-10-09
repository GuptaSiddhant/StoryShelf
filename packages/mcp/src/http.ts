import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { createApiClient } from "./client.ts";
import { createStoryShelfMcpServer } from "./server.ts";

/** Options for the Streamable HTTP handler. */
export interface McpHttpOptions {
  /** Upstream StoryShelf server base URL. */
  url: string;
  /** Default project slug for tool calls that omit `project`. */
  slug?: string;
  /** Browser origins allowed to call the endpoint (DNS-rebinding guard). Default: none. */
  allowedOrigins?: readonly string[];
}

/** Web-standard request handler: mount it on Hono, Node, Deno or Bun. */
export type McpHttpHandler = (request: Request) => Promise<Response>;

/**
 * Create a stateless Streamable HTTP MCP handler. Each request carries its own
 * `Authorization: Bearer` token, which is forwarded to `/api/v1`, so StoryShelf's
 * project scoping and roles apply per caller and no token is stored here.
 */
export function createMcpHttpHandler(options: McpHttpOptions): McpHttpHandler {
  return async (request) => {
    const rejected = rejectRequest(request, options);
    if (rejected) return rejected;
    const token = bearerToken(request);
    const server = createStoryShelfMcpServer(
      createApiClient({ url: options.url, token, ...(options.slug ? { slug: options.slug } : {}) }),
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await server.close();
    }
  };
}

/** Start a Node HTTP server exposing the handler at `/mcp`. */
export async function serveHttp(
  options: McpHttpOptions & { port: number; host?: string },
): Promise<Server> {
  const handler = createMcpHttpHandler(options);
  const server = createServer((incoming, outgoing) => {
    handleNode(handler, incoming, outgoing).catch(() => outgoing.writeHead(500).end());
  });
  await new Promise<void>((resolve) => {
    server.listen(options.port, options.host ?? "127.0.0.1", resolve);
  });
  return server;
}

function rejectRequest(request: Request, options: McpHttpOptions): Response | undefined {
  const origin = request.headers.get("origin");
  if (origin && !options.allowedOrigins?.includes(origin)) {
    return jsonError(403, "Origin not allowed");
  }
  if (!bearerToken(request)) {
    return Response.json(
      { error: "Missing Bearer token" },
      {
        status: 401,
        headers: {
          "content-type": "application/json",
          "www-authenticate": 'Bearer realm="storyshelf"',
        },
      },
    );
  }
  return undefined;
}

function bearerToken(request: Request): string {
  const match = /^Bearer\s+(?<token>.+)$/iu.exec(request.headers.get("authorization") ?? "");
  return match?.groups?.["token"] ?? "";
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

async function handleNode(
  handler: McpHttpHandler,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  const url = new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? "localhost"}`);
  if (url.pathname !== "/mcp") {
    outgoing.writeHead(404).end();
    return;
  }
  const response = await handler(toRequest(incoming, url));
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

function toRequest(incoming: IncomingMessage, url: URL): Request {
  const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
  return new Request(url, {
    method: incoming.method ?? "GET",
    headers: incoming.headers as Record<string, string>,
    ...(hasBody ? { body: Readable.toWeb(incoming), duplex: "half" } : {}),
  } as RequestInit);
}
