/* oxlint-disable max-statements */
import type { CheckStatus } from "@storyshelf/core/adapter/git-host";
import { describeStatus } from "@storyshelf/core/adapter/git-host/helpers";
import type { Logger } from "@storyshelf/core/logger";
import { httpJson } from "@storyshelf/core/utils";
import { apiBase, gitlabHeaders, projectId } from "./helpers.ts";
import { mapStatus } from "./mapper.ts";

/** Post a StoryShelf build status to a GitLab commit SHA. */
export async function postCommitStatus(opts: {
  owner: string;
  repo: string;
  host: string | undefined;
  token: string;
  context: string;
  gitSha: string;
  status: CheckStatus;
  url: string;
  logger?: Logger;
}): Promise<void> {
  const base = apiBase(opts.host);
  const pid = projectId(opts.owner, opts.repo);
  const glContext = `storyshelf/${opts.context}`;
  const state = mapStatus(opts.status);
  opts.logger?.debug(
    { context: glContext, sha: opts.gitSha, state, url: opts.url },
    "posting commit status",
  );
  try {
    await httpJson(`${base}/api/v4/projects/${pid}/statuses/${encodeURIComponent(opts.gitSha)}`, {
      method: "POST",
      headers: gitlabHeaders(opts.token),
      json: {
        state,
        target_url: opts.url,
        description: describeStatus(opts.status),
        name: glContext,
        context: glContext,
      },
      logger: opts.logger,
    });
    opts.logger?.info({ context: glContext, sha: opts.gitSha, state }, "commit status posted");
  } catch (error) {
    opts.logger?.error(
      { err: error, context: glContext, sha: opts.gitSha },
      "failed to post commit status",
    );
    throw error;
  }
}
