import type { BuildStateFlags } from "@storyshelf/core/adapter/notifier";
import type { Project } from "@storyshelf/core/schema";

/**
 * What decides which statuses a project's builds show: the instance's `testing` and the project's
 * review switch (a row without the column, from a hand-built table, counts as on, the default).
 */
export function buildStateFlags(
  testing: boolean,
  project: Pick<Project, "reviewEnabled">,
): BuildStateFlags {
  return { testing, review: project.reviewEnabled !== false };
}
