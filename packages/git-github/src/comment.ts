/* oxlint-disable max-statements, max-lines-per-function */
import type { Octokit } from "@octokit/rest";

import { findPrNumber } from "./pr.ts";

import type { Logger } from "pino";

export async function upsertPrComment(opts: {
  octokit: Octokit;
  owner: string;
  repo: string;
  sha: string;
  url: string;
  markdown: string;
  prNumber: number | undefined;
  logger?: Logger;
}): Promise<string> {
  const marker = `<!-- storyshelf:${opts.url} -->`;
  const body = `${marker}\n${opts.markdown}`;
  let resolved: number | undefined = opts.prNumber;
  resolved ??= await findPrNumber({
    octokit: opts.octokit,
    owner: opts.owner,
    repo: opts.repo,
    sha: opts.sha,
  });
  if (resolved === undefined) {
    opts.logger?.debug({ sha: opts.sha }, "no PR found for comment, skipping");
    return "";
  }
  try {
    const comments = await opts.octokit.issues.listComments({
      owner: opts.owner,
      repo: opts.repo,
      issue_number: resolved,
      per_page: 100,
    });
    const existing = comments.data.find((comment) => comment.body?.includes(marker));
    if (existing) {
      const updated = await opts.octokit.issues.updateComment({
        owner: opts.owner,
        repo: opts.repo,
        comment_id: existing.id,
        body,
      });
      opts.logger?.info({ prNumber: resolved, commentId: updated.data.id }, "git comment updated");
      return String(updated.data.id);
    }
    const created = await opts.octokit.issues.createComment({
      owner: opts.owner,
      repo: opts.repo,
      issue_number: resolved,
      body,
    });
    opts.logger?.info({ prNumber: resolved, commentId: created.data.id }, "git comment created");
    return String(created.data.id);
  } catch (error) {
    opts.logger?.error({ err: error, prNumber: resolved }, "failed to upsert git comment");
    throw error;
  }
}
