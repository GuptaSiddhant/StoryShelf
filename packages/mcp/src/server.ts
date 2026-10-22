import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolsFor, type InstanceCapabilities } from "./capabilities.ts";
import { toToolError, type ApiClient } from "./client.ts";
import { ALL_TOOLS } from "./tools/index.ts";

/** What a server assumes of an instance that was not asked: nothing is hidden. */
const ALL_CAPABILITIES: InstanceCapabilities = { testing: true };

declare const __PKG_VERSION__: string;

/**
 * Create the StoryShelf MCP server over an {@link ApiClient}. Transport-agnostic:
 * connect it to stdio or Streamable HTTP.
 */
export function createStoryShelfMcpServer(
  client: ApiClient,
  capabilities: InstanceCapabilities = ALL_CAPABILITIES,
): McpServer {
  const server = new McpServer(
    {
      name: "storyshelf",
      version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0-dev",
    },
    {
      instructions:
        "StoryShelf visual testing for Storybook. Inspect builds, snapshot diffs, capture logs and advisory AI triage; add review comments. Approving or rejecting snapshots is not available: leave that to a human in the StoryShelf UI.",
    },
  );
  registerTools(server, client, capabilities);
  registerPrompts(server, capabilities);
  return server;
}

function registerTools(
  server: McpServer,
  client: ApiClient,
  capabilities: InstanceCapabilities,
): void {
  for (const tool of toolsFor(ALL_TOOLS, capabilities)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        try {
          const data = await tool.run(client, args);
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: toToolError(error).message }],
          };
        }
      },
    );
  }
}

/** The steps of the review prompt: the capture tools are named only when the instance serves them. */
function reviewSteps(testing: boolean): string {
  return testing
    ? "Call get_build, then list_snapshots, then get_build_insight (if AI is enabled) and get_capture_logs if the build failed. Summarise: what changed, which snapshots look like regressions vs intended changes, and what a human reviewer should check first."
    : "Call get_build (this instance has no capture, so there are no snapshots, insight or capture logs). Summarise: what the build contains and what a human reviewer should check first.";
}

function registerPrompts(server: McpServer, capabilities: InstanceCapabilities): void {
  server.registerPrompt(
    "review-build",
    {
      title: "Review a build",
      description: "Summarise a build's visual changes and recommend what a human should look at.",
      argsSchema: { buildId: z.string(), project: z.string().optional() },
    },
    ({ buildId, project }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Review StoryShelf build ${buildId}${project ? ` in project ${project}` : ""}. ${reviewSteps(capabilities.testing)} Do not approve anything; you may add_comment with findings if asked.`,
          },
        },
      ],
    }),
  );
}
