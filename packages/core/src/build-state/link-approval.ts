/**
 * Approving repository links (ADR 0054, decision 2). A site admin's approval checks coverage with
 * the connection's own credentials, pins the host's repository id (and installation), then asks
 * again for the state of the project's open builds through that link, as confirming a public
 * origin does, so open pull requests get their check without waiting for the next push. With the
 * operator switch on, a link a project admin requests is approved at once the same way.
 */
import {
  resolveLinkCoverage,
  type LinkCoverage,
} from "../integrations/git/connections/link-host.ts";
import type { Logger } from "../logger.ts";
import type { GitConnectionModel } from "../models/git-connection.ts";
import { GitLinkStateError } from "../models/git-link-state-error.ts";
import {
  anyRepositoryLinkAllowed,
  GitRepositoryLinkModel,
  type GitRepositoryLinkInput,
} from "../models/git-repository-link.ts";
import type { SiteSettingsModel } from "../models/site-settings.ts";
import type { GitRepositoryLinkRow } from "../schema/git-connection.ts";
import { requestOpenBuildStates } from "./resume.ts";
import type { BuildStateDeps, BuildStatePublisher } from "./types.ts";

/** What approving needs. */
export interface LinkApprovalDeps {
  db: BuildStateDeps["db"];
  gitConnections: GitConnectionModel;
  /** Asked for the project's open builds once a link is approved. */
  publisher: BuildStatePublisher;
  logger: Logger;
}

/** How an approval ended: approved (with the link), or why not (shown to the site admin only). */
export type LinkApproval =
  | { approved: true; link: GitRepositoryLinkRow; asked: number }
  | { approved: false; reason: "not-covered" | "no-connection" };

/**
 * Approve a `pending` link (or reconnect a `broken` one) after checking that its connection covers
 * the repository. A repository the connection does not reach cannot be approved. An inconclusive
 * answer from the host throws, and the link stays as it was.
 * @throws GitLinkStateError when the link is gone or neither pending nor broken.
 */
export async function approveRepositoryLink(
  deps: LinkApprovalDeps,
  linkId: string,
  approvedBy: string | null,
): Promise<LinkApproval> {
  const links = new GitRepositoryLinkModel(deps.db);
  const link = await links.get(linkId);
  if (link === null || (link.state !== "pending" && link.state !== "broken")) {
    throw new GitLinkStateError("approved", link?.state ?? null);
  }
  const coverage = await coverageOf(deps, link);
  if (coverage === null || !coverage.covered) {
    return { approved: false, reason: coverage === null ? "no-connection" : "not-covered" };
  }
  const approved = await links.approve(link.id, coverage, approvedBy);
  const asked = await requestOpenBuildStates(deps, deps.publisher, {
    projectId: approved.projectId,
    linkId: approved.id,
  });
  return { approved: true, link: approved, asked };
}

/** Whether the link's connection covers its repository; null when the connection is gone. */
async function coverageOf(
  deps: Pick<LinkApprovalDeps, "gitConnections">,
  link: GitRepositoryLinkRow,
): Promise<LinkCoverage | null> {
  const connection = await deps.gitConnections.get(link.connectionId);
  const secret = connection ? await deps.gitConnections.secretOf(connection.id) : null;
  return connection && secret ? await resolveLinkCoverage(connection, secret, link) : null;
}

/**
 * A project admin asks to link a repository. The link is `pending` (it posts nothing until a site
 * admin approves it), unless the operator switch is on: then it is approved at once when the
 * connection covers the repository. The answer is the link only; a project admin is never told
 * whether the repository exists or is covered (decision 2), so a failed or negative check leaves
 * it pending without saying why.
 * @throws GitRepositoryTakenError when the repository and prefix are already linked.
 */
export async function requestRepositoryLink(
  deps: LinkApprovalDeps & { settings: SiteSettingsModel },
  input: GitRepositoryLinkInput,
): Promise<GitRepositoryLinkRow> {
  const link = await new GitRepositoryLinkModel(deps.db).create(input);
  if (!(await anyRepositoryLinkAllowed(deps.settings))) {
    return link;
  }
  try {
    const result = await approveRepositoryLink(deps, link.id, input.requestedBy ?? null);
    return result.approved ? result.link : link;
  } catch (error) {
    deps.logger.warn({ err: error, linkId: link.id }, "could not approve the link at once");
    return link;
  }
}
