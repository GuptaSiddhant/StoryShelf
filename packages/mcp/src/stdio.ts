import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { probeCapabilities } from "./capabilities.ts";
import { createApiClient } from "./client.ts";
import type { McpConfig } from "./config.ts";
import { createStoryShelfMcpServer } from "./server.ts";

/** Serve MCP over stdio (local agents: Claude Code, Cursor). Logs go to stderr only. */
export async function runStdio(config: McpConfig): Promise<void> {
  const client = createApiClient(config);
  const server = createStoryShelfMcpServer(client, await probeCapabilities(client));
  await server.connect(new StdioServerTransport());
}
