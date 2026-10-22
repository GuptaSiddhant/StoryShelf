import type { NotifierState } from "@storyshelf/core/adapter/notifier";
import type { Logger } from "@storyshelf/core/logger";
import { httpJson } from "@storyshelf/core/utils";
import { apiBase, gitlabHeaders, projectId } from "./gitlab-api.ts";
import { mapState } from "./gitlab-mapper.ts";

/** Coordinates and credential of one GitLab project. */
export interface GitLabProject {
  token: string;
  owner: string;
  repo: string;
  /** GitLab host URL; `https://gitlab.com` when undefined. */
  host: string | undefined;
  logger?: Logger | undefined;
}

/**
 * Post a commit status to GitLab under the full `context` name the caller chose
 * (`<prefix>/testing`); the provider adds no prefix of its own. Posting the same
 * `(sha, name)` again replaces the state, so it is idempotent and latest wins.
 */
export async function postCommitStatus(
  project: GitLabProject,
  input: {
    sha: string;
    context: string;
    state: NotifierState;
    description: string;
    /** Absent while no public origin is known. */
    url?: string | undefined;
  },
): Promise<void> {
  const base = apiBase(project.host);
  const pid = projectId(project.owner, project.repo);
  const state = mapState(input.state);
  project.logger?.debug({ context: input.context, sha: input.sha, state }, "posting commit status");
  try {
    await httpJson(`${base}/api/v4/projects/${pid}/statuses/${encodeURIComponent(input.sha)}`, {
      method: "POST",
      headers: gitlabHeaders(project.token),
      json: {
        state,
        ...(input.url === undefined ? {} : { target_url: input.url }),
        description: input.description,
        name: input.context,
        context: input.context,
      },
      logger: project.logger,
    });
  } catch (error) {
    project.logger?.error(
      { err: error, context: input.context, sha: input.sha },
      "failed to post commit status",
    );
    throw error;
  }
}
