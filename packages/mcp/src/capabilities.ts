/**
 * What the StoryShelf instance behind the client offers (ADR 0017): its `GET /api/v1/health`
 * liveness body says whether it has the `testing` option. Without it every `testing` route answers
 * 404 (ADR 0006, decision 8), so the server does not advertise the tools that call them.
 */
import type { ApiClient } from "./client.ts";
import type { ToolDef } from "./tools/types.ts";

/** What the server needs to know of the instance. */
export interface InstanceCapabilities {
  /** Whether the instance runs capture and comparison (`testing`). */
  testing: boolean;
}

/**
 * Read the instance's capabilities. An instance that does not say (an older one) or cannot be
 * reached counts as having `testing`, so no tool is hidden on a guess.
 */
export async function probeCapabilities(client: ApiClient): Promise<InstanceCapabilities> {
  try {
    const body = await client.get<{ testing?: unknown }>("/health");
    return { testing: body.testing !== false };
  } catch {
    return { testing: true };
  }
}

/** The tools an instance with these capabilities serves: `testing` tools only when it has `testing`. */
export function toolsFor(
  tools: readonly ToolDef[],
  capabilities: InstanceCapabilities,
): readonly ToolDef[] {
  return tools.filter((tool) => tool.routeClass !== "testing" || capabilities.testing);
}
