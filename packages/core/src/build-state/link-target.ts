/**
 * Delivering a build's state through a repository link (ADR 0054, decisions 2, 6, 7 and 10). Only
 * an `approved` link posts; its credential is its connection's, never a channel secret. Delivery is
 * pinned to the repository id the approval recorded: a GitHub installation token for that id only
 * (`repository_ids`), GitLab addressed by the numeric project id. When the host refuses a write
 * (401, 403, 404) the link itself is checked again: only a definitive negative marks it `broken`;
 * otherwise the original error is thrown and the job retries as before.
 */
import type { NotifierProvider } from "../adapters/notifier/index.ts";
import { cappedOutputs } from "../adapters/notifier/outputs.ts";
import { isStateProvider } from "../adapters/notifier/provider.ts";
import { recheckLink, type LinkRecheck } from "../integrations/git/connections/link-host.ts";
import type { Logger } from "../logger.ts";
import type { GitConnection } from "../models/git-connection.ts";
import { GitRepositoryLinkModel, linkOutputsOf } from "../models/git-repository-link.ts";
import type { Build } from "../schema/build.ts";
import type { GitRepositoryLinkRow } from "../schema/git-connection.ts";
import type { Project } from "../schema/project.ts";
import { HttpError } from "../utils/index.ts";
import { linkChannel, postsComments } from "./link-channel.ts";
import type { BuildStateDeps, SkipReason, StateTarget } from "./types.ts";

/** What reaching a link needs. */
export type LinkDeps = Pick<BuildStateDeps, "db" | "notifiers" | "gitConnections"> & {
  logger?: Logger | undefined;
};

/** Why a link cannot be delivered to right now. */
type LinkSkip = Extract<SkipReason, "no-connection" | "no-provider" | "link-broken">;

/** HTTP answers after which the link itself is checked again (decision 6). */
const REFUSALS: ReadonlySet<number> = new Set([401, 403, 404]);

/** The approved links of a project; none without connections. */
export async function approvedLinks(
  deps: Pick<LinkDeps, "db" | "gitConnections">,
  projectId: string,
): Promise<GitRepositoryLinkRow[]> {
  if (deps.gitConnections === undefined) {
    return [];
  }
  const links = await new GitRepositoryLinkModel(deps.db).list(projectId);
  return links.filter((link) => link.state === "approved");
}

/** The project's approved links as targets; a link that cannot be reached is logged and left out. */
export async function linkTargets(deps: LinkDeps, projectId: string): Promise<StateTarget[]> {
  const links = await approvedLinks(deps, projectId);
  const targets = await Promise.all(
    links.map(async (link) => {
      try {
        const target = await linkTarget(deps, link);
        return typeof target === "string" ? [] : [target];
      } catch (error) {
        deps.logger?.warn({ err: error, linkId: link.id }, "repository link could not be reached");
        return [];
      }
    }),
  );
  return targets.flat();
}

/**
 * An approved link as a target: its connection's credential, pinned to the approved repository id.
 * A link approved without pins (from configuration) is resolved and pinned first; a definitive
 * "not covered" marks it broken. An inconclusive lookup throws.
 */
export async function linkTarget(
  deps: LinkDeps,
  link: GitRepositoryLinkRow,
): Promise<StateTarget | LinkSkip> {
  const held = await connectionOf(deps, link);
  if (held === null) {
    return "no-connection";
  }
  const pinned = needsPins(link) ? await pinLink(deps, { link, ...held }) : link;
  return typeof pinned === "string" ? pinned : targetOf(deps, pinned, held);
}

/** The link's connection and its secret, or null when either is gone. */
async function connectionOf(
  deps: Pick<LinkDeps, "gitConnections">,
  link: GitRepositoryLinkRow,
): Promise<{ connection: GitConnection; secret: string } | null> {
  const connection = await deps.gitConnections?.get(link.connectionId);
  const secret = connection ? await deps.gitConnections?.secretOf(connection.id) : null;
  return connection && secret ? { connection, secret } : null;
}

/** The pinned link as a target, with its choices capped by the connection's ceiling. */
function targetOf(
  deps: Pick<LinkDeps, "notifiers">,
  link: GitRepositoryLinkRow,
  held: { connection: GitConnection; secret: string },
): StateTarget | "no-provider" {
  const channel = linkChannel(link, held.connection, held.secret);
  const provider = providerOf(deps.notifiers, channel?.provider);
  if (channel === null || provider === undefined) {
    return "no-provider";
  }
  const ceiling = { pullRequests: postsComments(held.connection) };
  return {
    channel,
    provider,
    link: { id: link.id, outputs: cappedOutputs(linkOutputsOf(link), ceiling) },
  };
}

function needsPins(link: GitRepositoryLinkRow): boolean {
  return link.hostRepositoryId === null;
}

function providerOf(
  notifiers: readonly NotifierProvider[],
  kind: string | undefined,
): StateTarget["provider"] | undefined {
  const provider = notifiers.find((candidate) => candidate.metadata.kind === kind);
  return provider !== undefined && isStateProvider(provider) ? provider : undefined;
}

/** Resolve and pin an approved link's repository id; a definitive "not covered" breaks it. */
async function pinLink(
  deps: LinkDeps,
  held: { link: GitRepositoryLinkRow; connection: GitConnection; secret: string },
): Promise<GitRepositoryLinkRow | "link-broken"> {
  const answer = await recheckLink(held.connection, held.secret, held.link);
  const links = new GitRepositoryLinkModel(deps.db);
  if (!answer.ok) {
    await breakLink(deps, held.link.id, answer.reason);
    return "link-broken";
  }
  return (await links.pin(held.link.id, answer)) ?? { ...held.link, ...answer };
}

async function breakLink(deps: LinkDeps, linkId: string, reason: string): Promise<void> {
  await new GitRepositoryLinkModel(deps.db).markBroken(linkId, reason);
  deps.logger?.warn(
    { linkId, reason },
    "repository link is broken; it posts nothing until reconnected",
  );
}

/**
 * Show the build's state through link `linkId`. Throws when the host refused and the link still
 * holds (or the check was inconclusive), so the job retries; resolves to why nothing was written
 * when the link does not post or broke.
 */
export async function deliverToLink(
  deps: BuildStateDeps,
  loaded: { build: Build; project: Project },
  where: {
    linkId: string;
    write: (target: StateTarget) => Promise<void>;
  },
): Promise<"delivered" | SkipReason> {
  const found = await deliverableLink(deps, where.linkId, loaded.project.id);
  if (typeof found === "string") {
    return found;
  }
  try {
    await where.write(found.target);
    return "delivered";
  } catch (error) {
    return await afterRefusal(deps, found.link, error);
  }
}

/** The link and its target, or why it posts nothing. */
async function deliverableLink(
  deps: BuildStateDeps,
  linkId: string,
  projectId: string,
): Promise<{ link: GitRepositoryLinkRow; target: StateTarget } | SkipReason> {
  const link = await new GitRepositoryLinkModel(deps.db).get(linkId);
  const skip = skipOf(deps, link, projectId);
  if (skip !== null || link === null) {
    return skip ?? "no-channel";
  }
  const target = await linkTarget(deps, link);
  return typeof target === "string" ? target : { link, target };
}

/** Why a link posts nothing before its target is built: gone, another project's, or not approved. */
function skipOf(
  deps: Pick<BuildStateDeps, "gitConnections">,
  link: GitRepositoryLinkRow | null,
  projectId: string,
): SkipReason | null {
  if (link === null || link.projectId !== projectId) {
    return "no-channel";
  }
  if (link.state !== "approved") {
    return "link-not-approved";
  }
  return deps.gitConnections === undefined ? "no-connection" : null;
}

/**
 * A refused write: check the link itself. A definitive negative breaks it ("link-broken"); a link
 * that still holds (the refusal was about the commit) or an inconclusive check rethrows `error`.
 */
async function afterRefusal(
  deps: BuildStateDeps,
  link: GitRepositoryLinkRow,
  error: unknown,
): Promise<"link-broken"> {
  if (!(error instanceof HttpError) || !REFUSALS.has(error.status)) {
    throw error;
  }
  const answer = await recheckOrNull(deps, link);
  if (answer?.ok === false) {
    await breakLink(deps, link.id, answer.reason);
    return "link-broken";
  }
  if (answer?.ok === true && answer.installationId !== link.installationId) {
    await new GitRepositoryLinkModel(deps.db).pin(link.id, answer);
  }
  throw error;
}

/** The link's re-check, or null when it could not be answered (logged; the job retries). */
async function recheckOrNull(
  deps: BuildStateDeps,
  link: GitRepositoryLinkRow,
): Promise<LinkRecheck | null> {
  const held = await connectionOf(deps, link);
  if (held === null) {
    return null;
  }
  try {
    return await recheckLink(held.connection, held.secret, link);
  } catch (checkError) {
    deps.logger.warn(
      { err: checkError, linkId: link.id },
      "repository link check was inconclusive",
    );
    return null;
  }
}
