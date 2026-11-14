import type { NotifierState } from "../../adapters/notifier/index.ts";
import type { Logger } from "../../logger.ts";
import { httpJson } from "../../utils/index.ts";
import { githubHeaders, repoPath } from "./github-api.ts";
import { mapState } from "./github-mapper.ts";

/** Coordinates and credential of one GitHub repository. */
export interface GitHubRepo {
  token: string;
  owner: string;
  repo: string;
  /** GitHub Enterprise Server API base; absent means github.com. */
  apiUrl?: string | undefined;
  logger?: Logger | undefined;
}

/**
 * Post a commit status to GitHub under the full `context` name the caller chose
 * (`<prefix>/testing`); the provider adds no prefix of its own. Posting the same
 * `(sha, context)` again replaces the state, so it is idempotent and latest wins.
 */
export async function postCommitStatus(
  repo: GitHubRepo,
  input: {
    sha: string;
    context: string;
    state: NotifierState;
    description: string;
    /** Absent while no public origin is known. */
    url?: string | undefined;
  },
): Promise<void> {
  const state = mapState(input.state);
  repo.logger?.debug({ context: input.context, sha: input.sha, state }, "posting commit status");
  try {
    await httpJson(repoPath(repo, `/statuses/${encodeURIComponent(input.sha)}`), {
      method: "POST",
      headers: githubHeaders(repo.token),
      json: {
        state,
        ...(input.url === undefined ? {} : { target_url: input.url }),
        description: input.description,
        context: input.context,
      },
      logger: repo.logger,
    });
  } catch (error) {
    repo.logger?.error(
      { err: error, context: input.context, sha: input.sha },
      "failed to post commit status",
    );
    throw error;
  }
}
