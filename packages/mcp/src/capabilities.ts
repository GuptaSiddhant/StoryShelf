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
  /** Whether the instance has AI configured (advisory triage and health digests). */
  ai: boolean;
}

/**
 * Read the instance's capabilities. An instance that does not say (an older one) or cannot be
 * reached counts as having each capability, so no tool is hidden on a guess.
 */
export async function probeCapabilities(client: ApiClient): Promise<InstanceCapabilities> {
  try {
    const body = await client.get<{ testing?: unknown; ai?: unknown }>("/health");
    return { testing: body.testing !== false, ai: body.ai !== false };
  } catch {
    return { testing: true, ai: true };
  }
}

/**
 * The tools an instance with these capabilities serves: `testing` tools only when it has `testing`,
 * AI tools only when it has AI.
 */
export function toolsFor(
  tools: readonly ToolDef[],
  capabilities: InstanceCapabilities,
): readonly ToolDef[] {
  return tools.filter(
    (tool) =>
      (tool.routeClass !== "testing" || capabilities.testing) &&
      (tool.requiresAi !== true || capabilities.ai),
  );
}
