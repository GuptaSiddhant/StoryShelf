/* oxlint-disable max-statements */
import type { CheckStatus } from "@storyshelf/core/adapter/git-host";
import { describeStatus } from "@storyshelf/core/adapter/git-host/helpers";
import type { Logger } from "@storyshelf/core/logger";
import { httpJson } from "@storyshelf/core/utils";
import { githubHeaders, repoPath } from "./api.ts";
import { mapStatus } from "./mapper.ts";

/**
 * Post a StoryShelf build status to a GitHub commit.
 *
 * Creates a commit status under `storyshelf/<context>` so the PR shows
 * StoryShelf's check alongside other CI. Maps StoryShelf's `CheckStatus`
 * (`pending`/`success`/`failure`) to GitHub's `state`.
 *
 * @param opts - Commit and auth details
 * @param opts.token - GitHub PAT with `repo:status` scope
 * @param opts.owner - Repository owner
 * @param opts.repo - Repository name
 * @param opts.context - StoryShelf context (e.g. `storybook`); namespaced as `storyshelf/<context>`
 * @param opts.gitSha - Full commit SHA to attach the status to
 * @param opts.status - StoryShelf build status to report
 * @param opts.url - Target URL for the status (link back to the StoryShelf build page)
 * @param opts.logger - Optional logger for debug/error output
 */
export async function postCommitStatus(opts: {
  token: string;
  owner: string;
  repo: string;
  context: string;
  gitSha: string;
  status: CheckStatus;
  url: string;
  logger?: Logger;
}): Promise<void> {
  const ghContext = `storyshelf/${opts.context}`;
  const state = mapStatus(opts.status);
  opts.logger?.debug(
    { context: ghContext, sha: opts.gitSha, state, url: opts.url },
    "posting commit status",
  );
  try {
    await httpJson(
      repoPath(opts.owner, opts.repo, `/statuses/${encodeURIComponent(opts.gitSha)}`),
      {
        method: "POST",
        headers: githubHeaders(opts.token),
        json: {
          state,
          target_url: opts.url,
          description: describeStatus(opts.status),
          context: ghContext,
        },
        logger: opts.logger,
      },
    );
    opts.logger?.info({ context: ghContext, sha: opts.gitSha, state }, "commit status posted");
  } catch (error) {
    opts.logger?.error(
      { err: error, context: ghContext, sha: opts.gitSha },
      "failed to post commit status",
    );
    throw error;
  }
}
