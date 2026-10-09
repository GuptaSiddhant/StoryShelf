import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApiClient } from "./client.ts";
import type { McpConfig } from "./config.ts";
import { createStoryShelfMcpServer } from "./server.ts";

/** Serve MCP over stdio (local agents: Claude Code, Cursor). Logs go to stderr only. */
export async function runStdio(config: McpConfig): Promise<void> {
  const server = createStoryShelfMcpServer(createApiClient(config));
  await server.connect(new StdioServerTransport());
}
