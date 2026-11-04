/**
 * A `review` route answers 404 for a project that has review off (ADR 0013, decision 10), which an
 * agent would read as a wrong slug or build id. When a review tool meets a 404, ask the project
 * (a hosting read, no new route) and say so if review is the reason. The 404 itself is unchanged.
 */
import { ToolError, type ApiClient } from "./client.ts";
import { projectSlug, type ToolDef } from "./tools/types.ts";

/** What an agent is told when the project exists but review is off. */
export const REVIEW_OFF_MESSAGE =
  "StoryShelf API: review is off for this project, so comments are not available (a project admin can turn review on in the project settings)";

/**
 * The error to report for a failed call of `tool`: the original one, unless it is a 404 of a
 * review tool and the project is known to have review off. A failed project read keeps the
 * original error, so the project check can only make the answer more specific.
 */
export async function explainFailure(
  client: ApiClient,
  tool: ToolDef,
  args: Record<string, unknown>,
  error: ToolError,
): Promise<ToolError> {
  if (tool.routeClass !== "review" || error.status !== 404) {
    return error;
  }
  try {
    const project = await client.get<{ reviewEnabled?: unknown }>(
      `/projects/${projectSlug(client, args["project"])}`,
    );
    return project.reviewEnabled === false ? new ToolError(REVIEW_OFF_MESSAGE, 404) : error;
  } catch {
    return error;
  }
}
