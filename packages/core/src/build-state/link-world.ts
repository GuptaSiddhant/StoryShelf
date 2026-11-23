/**
 * Shared set-up of the repository-link delivery tests: the build-state world plus a configured
 * GitHub App connection, a stored GitLab connection and recording `github` / `gitlab` providers
 * that can be told to refuse with an HTTP status. No request leaves the process.
 */
import { z } from "zod";
import type {
  SetStateInput,
  StateNotifierMetadata,
  StateNotifierProvider,
} from "../adapters/notifier/provider.ts";
import { githubApp } from "../integrations/git/connections/define.ts";
import { TEST_PRIVATE_KEY } from "../integrations/git/test-key.ts";
import { GitConnectionModel } from "../models/git-connection.ts";
import { GitRepositoryLinkModel } from "../models/git-repository-link.ts";
import type { GitRepositoryLinkRow } from "../schema/git-connection.ts";
import { HttpError } from "../utils/index.ts";
import { SECRET, world, type World } from "./test-world.ts";

/** What one recording provider saw. */
export interface HostRecord {
  /** Config and secret of every adapter created. */
  created: { config: Record<string, unknown>; secret: string | undefined }[];
  writes: SetStateInput[];
  /** While set, every status write rejects with this HTTP status. */
  refuse: { status: number | null };
  /** The answer to a default-branch claim. */
  onBranch: boolean;
}

/** The world with connections, links and recording git providers. */
export interface LinkWorld extends World {
  links: GitRepositoryLinkModel;
  connections: GitConnectionModel;
  github: HostRecord;
  gitlab: HostRecord;
  /** Id of the stored GitLab connection. */
  gitlabId: string;
}

/** Id of the configured GitHub App connection. */
export const GITHUB_ID = "gh";

export async function linkWorld(): Promise<LinkWorld> {
  const w = await world();
  const github = record();
  const gitlab = record();
  const connections = new GitConnectionModel(w.db, SECRET, [
    githubApp({ id: GITHUB_ID, appId: 42, privateKey: TEST_PRIVATE_KEY }),
  ]);
  const stored = await connections.create({
    provider: "gitlab-token",
    name: "GitLab",
    apiBase: "https://git.example.com",
    config: { expiresOn: "2099-01-01" },
    secret: "glpat-secret",
  });
  w.deps.notifiers = [...w.deps.notifiers, provider("github", github), provider("gitlab", gitlab)];
  w.deps.gitConnections = connections;
  const links = new GitRepositoryLinkModel(w.db);
  return { ...w, links, connections, github, gitlab, gitlabId: stored.id };
}

/** An approved GitHub link of the world's project, pinned to repository 9001 under installation 777. */
export async function approvedGitHubLink(
  w: LinkWorld,
  overrides: { prefix?: string } = {},
): Promise<GitRepositoryLinkRow> {
  const link = await w.links.create({
    projectId: w.project.id,
    connectionId: GITHUB_ID,
    host: "api.github.com",
    owner: "acme",
    repo: "web",
    ...overrides,
  });
  return await w.links.approve(link.id, { hostRepositoryId: "9001", installationId: "777" }, "u1");
}

function record(): HostRecord {
  return { created: [], writes: [], refuse: { status: null }, onBranch: true };
}

function provider(kind: string, host: HostRecord): StateNotifierProvider {
  const metadata: StateNotifierMetadata = {
    name: kind,
    version: "0.0.0",
    kind,
    category: "notifier",
    delivery: "state",
    schema: z.object({}).loose(),
  };
  return {
    metadata,
    create: ({ config, secret }) => {
      host.created.push({ config: config as Record<string, unknown>, secret });
      return {
        metadata,
        setState: async (input) => {
          await Promise.resolve();
          if (host.refuse.status !== null && input.target.kind === "status") {
            throw new HttpError(host.refuse.status, "refused");
          }
          host.writes.push(input);
        },
        commitOnBranch: async () => await Promise.resolve(host.onBranch),
      };
    },
  };
}

/** The status contexts a host was shown. */
export function contextsOf(host: HostRecord): string[] {
  return host.writes.flatMap((write) =>
    write.target.kind === "status" ? [write.target.context] : [],
  );
}
