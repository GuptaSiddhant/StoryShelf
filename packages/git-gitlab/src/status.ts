/* oxlint-disable max-statements */
import { describeStatus } from "@storyshelf/core/adapter/git-host/helpers";

import { apiBase, gitlabHeaders, projectId } from "./helpers.ts";
import { mapStatus } from "./mapper.ts";

import type { CheckStatus } from "@storyshelf/core";
import type { Logger } from "@storyshelf/core/types";

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
  opts.logger?.debug({ context: glContext, sha: opts.gitSha, state, url: opts.url }, "posting commit status");
  try {
    const res = await fetch(`${base}/api/v4/projects/${pid}/statuses/${encodeURIComponent(opts.gitSha)}`, {
      method: "POST",
      headers: gitlabHeaders(opts.token),
      body: JSON.stringify({
        state,
        target_url: opts.url,
        description: describeStatus(opts.status),
        name: glContext,
        context: glContext,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitLab status ${res.status}: ${text}`);
    }
    opts.logger?.info({ context: glContext, sha: opts.gitSha, state }, "commit status posted");
  } catch (error) {
    opts.logger?.error({ err: error, context: glContext, sha: opts.gitSha }, "failed to post commit status");
    throw error;
  }
}
