import { z } from "zod";

import type { Logger } from "pino";
import type { CheckStatus, GitHostAdapter, GitHostProvider } from "@storyshelf/core";

declare const __PKG_VERSION__: string;

const gitlabConfigSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  host: z.string().url().optional(),
});

interface GitLabStatusOptions {
  token: string;
  owner: string;
  repo: string;
  host?: string;
  logger?: Logger;
}

function getMetadata(): GitHostProvider["metadata"] {
  return {
    name: "GitLab",
    version: typeof __PKG_VERSION__ === "undefined" ? "0.0.0" : __PKG_VERSION__, // oxlint-disable-line unicorn/no-typeof-undefined
    description: "Commit statuses via GitLab API",
    kind: "gitlab",
    logo: "gitlab",
    schema: gitlabConfigSchema,
  };
}

function projectId(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
}

function apiBase(host: string | undefined): string {
  const base = host ?? "https://gitlab.com";
  return base.replace(/\/+$/u, "");
}

function gitlabHeaders(token: string): Record<string, string> {
  return {
    "PRIVATE-TOKEN": token,
    "content-type": "application/json",
  };
}

function createGitLabStatusAdapter(options: GitLabStatusOptions): GitHostAdapter {
  const host = apiBase(options.host);
  const pid = projectId(options.owner, options.repo);
  const logger = options.logger?.child({ component: "git-gitlab" });

  async function findMrIid(sha: string): Promise<number | undefined> {
    try {
      const url = `${host}/api/v4/projects/${pid}/repository/commits/${encodeURIComponent(sha)}/merge_requests`;
      const res = await fetch(url, { headers: gitlabHeaders(options.token) });
      if (!res.ok) return undefined;
      const data = (await res.json()) as Array<{ iid: number }>;
      return data[0]?.iid;
    } catch {
      return undefined;
    }
  }

  return {
    metadata: getMetadata(),
    async setStatus(context: string, gitSha: string, status: CheckStatus, url: string): Promise<void> {
      const glContext = `storyshelf/${context}`;
      const state = mapStatus(status);
      logger?.debug({ context: glContext, sha: gitSha, state, url }, "posting commit status");
      try {
        const res = await fetch(`${host}/api/v4/projects/${pid}/statuses/${encodeURIComponent(gitSha)}`, {
          method: "POST",
          headers: gitlabHeaders(options.token),
          body: JSON.stringify({
            state,
            target_url: url,
            description: describeStatus(status),
            name: glContext,
            context: glContext,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`GitLab status ${res.status}: ${text}`);
        }
        logger?.info({ context: glContext, sha: gitSha, state }, "commit status posted");
      } catch (error) {
        logger?.error({ err: error, context: glContext, sha: gitSha }, "failed to post commit status");
        throw error;
      }
    },
    async isMerged(opts: { sha: string; branch: string }): Promise<boolean> {
      try {
        const iid = await findMrIid(opts.sha);
        if (iid !== undefined) {
          const res = await fetch(`${host}/api/v4/projects/${pid}/merge_requests/${iid}`, {
            headers: gitlabHeaders(options.token),
          });
          if (!res.ok) return false;
          const mr = (await res.json()) as { state?: string; merged_at?: string | null };
          return mr.state === "merged" || mr.merged_at != null;
        }
        const res = await fetch(
          `${host}/api/v4/projects/${pid}/merge_requests?state=merged&source_branch=${encodeURIComponent(opts.branch)}&per_page=5`,
          { headers: gitlabHeaders(options.token) },
        );
        if (!res.ok) return false;
        const mrs = (await res.json()) as Array<{ sha?: string; merge_commit_sha?: string | null }>;
        return mrs.some((mr) => mr.sha === opts.sha || mr.merge_commit_sha === opts.sha);
      } catch (error) {
        logger?.debug({ err: error, sha: opts.sha, branch: opts.branch }, "isMerged check failed, not skipping");
        return false;
      }
    },
    async upsertComment(opts: {
      prNumber?: number;
      sha: string;
      url: string;
      status: CheckStatus;
      markdown: string;
    }): Promise<string> {
      const marker = `<!-- storyshelf:${opts.url} -->`;
      const body = `${marker}\n${opts.markdown}`;
      let iid = opts.prNumber;
      if (iid === undefined) {
        iid = await findMrIid(opts.sha);
      }
      if (iid === undefined) {
        logger?.debug({ sha: opts.sha }, "no MR found for comment, skipping");
        return "";
      }
      try {
        const listUrl = `${host}/api/v4/projects/${pid}/merge_requests/${iid}/notes?per_page=100`;
        const res = await fetch(listUrl, { headers: gitlabHeaders(options.token) });
        if (res.ok) {
          const notes = (await res.json()) as Array<{ id: number; body: string }>;
          const existing = notes.find((n) => n.body.includes(marker));
          if (existing) {
            const upd = await fetch(`${host}/api/v4/projects/${pid}/merge_requests/${iid}/notes/${existing.id}`, {
              method: "PUT",
              headers: gitlabHeaders(options.token),
              body: JSON.stringify({ body }),
            });
            if (!upd.ok) {
              const text = await upd.text();
              throw new Error(`update note ${upd.status}: ${text}`);
            }
            const data = (await upd.json()) as { id: number };
            logger?.info({ iid, commentId: data.id }, "gitlab comment updated");
            return String(data.id);
          }
        }
        const createdRes = await fetch(`${host}/api/v4/projects/${pid}/merge_requests/${iid}/notes`, {
          method: "POST",
          headers: gitlabHeaders(options.token),
          body: JSON.stringify({ body }),
        });
        if (!createdRes.ok) {
          const text = await createdRes.text();
          throw new Error(`create note ${createdRes.status}: ${text}`);
        }
        const data = (await createdRes.json()) as { id: number };
        logger?.info({ iid, commentId: data.id }, "gitlab comment created");
        return String(data.id);
      } catch (error) {
        logger?.error({ err: error, iid }, "failed to upsert gitlab comment");
        throw error;
      }
    },
  };
}

export const gitLabHost: GitHostProvider = {
  metadata: getMetadata(),
  create(opts: { config: unknown; token: string; logger?: Logger }): GitHostAdapter {
    const cfg = gitlabConfigSchema.parse(opts.config) as GitLabStatusOptions & { owner: string; repo: string };
    return createGitLabStatusAdapter({
      token: opts.token,
      owner: cfg.owner,
      repo: cfg.repo,
      host: cfg.host,
      logger: opts.logger,
    });
  },
};

function mapStatus(status: CheckStatus): string {
  switch (status) {
    case "pending":
      return "pending";
    case "success":
      return "success";
    case "failure":
      return "failed";
    default:
      return "failed";
  }
}

function describeStatus(status: CheckStatus): string {
  switch (status) {
    case "pending":
      return "Visual tests pending";
    case "success":
      return "Visual tests passed";
    case "failure":
      return "Visual changes detected or tests failed";
    default:
      return "Visual changes detected or tests failed";
  }
}
