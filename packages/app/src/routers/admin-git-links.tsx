/**
 * Repository link requests on System → Git (ADR 0054, decisions 2 and 6): a site admin opens a
 * pending (or broken) link, sees whether its connection covers the repository, and approves,
 * reconnects or refuses it. The dialogs answer HTMX with their body and a plain request with a page
 * (ADR 0012, decision 10). Coverage is shown to site admins only; a project admin never learns it.
 */
import { approveRepositoryLink } from "@storyshelf/core/build-state";
import { resolveLinkCoverage } from "@storyshelf/core/integrations";
import { GitLinkStateError, GitRepositoryLinkModel, ProjectModel } from "@storyshelf/core/models";
import type { GitRepositoryLinkRow } from "@storyshelf/core/schema";
import { HttpError } from "@storyshelf/core/utils";
import type { Context } from "hono";
import type { HtmlEscapedString } from "hono/utils/html";
import type { ShelfRouter } from "../app-types.ts";
import { gitConnectionModel, installUrlOf, linkView } from "../git-admin.ts";
import { requestBuildState } from "../git-status.ts";
import { LINK_DIALOG_ID, type GitLinkRequestView } from "../pages/admin-git.tsx";
import {
  ApproveLinkBody,
  RefuseLinkBody,
  renderLinkDialogPage,
  type GitCoverageView,
} from "../pages/git-link-dialogs.tsx";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { notFound, requireSiteAdmin } from "./helpers.ts";
import { hxRedirect, isHxRequest } from "./htmx.ts";

/** Longest refusal reason kept. */
const REASON_MAX = 500;

/** Register the approve and refuse dialogs and their posts. */
export function registerGitLinkRequests(app: ShelfRouter): void {
  app.get("/admin/git/links/:id/approve", handleApproveDialog);
  app.post("/admin/git/links/:id/approve", handleApprove);
  app.get("/admin/git/links/:id/refuse", handleRefuseDialog);
  app.post("/admin/git/links/:id/refuse", handleRefuse);
}

/** Whether the request came from inside the page's dialog (so the answer is its body). */
const inDialog = (c: Context): boolean =>
  isHxRequest(c) && c.req.header("HX-Target") === `${LINK_DIALOG_ID}-body`;

/** The dialog's body, or the same body on a page of its own. */
function answer(
  c: Context,
  title: string,
  body: HtmlEscapedString | Promise<HtmlEscapedString>,
  status: 200 | 409 | 422 = 200,
): Response | Promise<Response> {
  return inDialog(c) ? c.html(body, status) : c.html(renderLinkDialogPage(title, body), status);
}

const targetOf = (c: Context): string => (inDialog(c) ? `#${LINK_DIALOG_ID}-body` : "body");

/** A link a site admin decides on (pending or broken) with its view; 404 otherwise. */
async function openLink(
  c: Context,
): Promise<{ row: GitRepositoryLinkRow; view: GitLinkRequestView }> {
  requireSiteAdmin(c);
  const row = await new GitRepositoryLinkModel(getStore().db).get(c.req.param("id") ?? "");
  if (row === null || (row.state !== "pending" && row.state !== "broken")) {
    notFound("No open request for that link");
  }
  const projects = await new ProjectModel(getStore().db).list();
  return { row, view: linkView(row, projects, await gitConnectionModel().list()) };
}

/** Ask the connection's host whether it covers the link's repository. */
async function coverageOf(row: GitRepositoryLinkRow): Promise<GitCoverageView> {
  const model = gitConnectionModel();
  const connection = await model.get(row.connectionId);
  const secret = connection ? await model.secretOf(connection.id) : null;
  if (connection === null || secret === null) {
    return { kind: "no-connection" };
  }
  try {
    const coverage = await resolveLinkCoverage(connection, secret, row);
    return coverage.covered
      ? {
          kind: "covered",
          repositoryId: coverage.hostRepositoryId,
          installationId: coverage.installationId,
        }
      : { kind: "not-covered", installUrl: installUrlOf(connection) };
  } catch (error) {
    return {
      kind: "unreachable",
      detail: error instanceof HttpError ? `HTTP ${error.status}` : "no answer",
    };
  }
}

const approveTitle = (view: GitLinkRequestView): string =>
  view.state === "broken" ? "Reconnect repository link" : "Approve repository link";

async function handleApproveDialog(c: Context): Promise<Response> {
  const { row, view } = await openLink(c);
  const coverage = await coverageOf(row);
  return await answer(
    c,
    approveTitle(view),
    <ApproveLinkBody link={view} coverage={coverage} target={targetOf(c)} />,
  );
}

/** What a site admin is told after an approve post that went through or found the link moved. */
const APPROVE_FLASH = {
  moved: { message: "That link changed meanwhile; nothing was approved", tone: "warning" },
} as const;

/** Approve after checking coverage again; open builds are asked for their state through the link. */
async function handleApprove(c: Context): Promise<Response> {
  const { row, view } = await openLink(c);
  const outcome = await approveShown(c, row);
  if (outcome !== "refused") {
    const done = { message: `${view.repository} approved`, tone: "success" } as const;
    const { message, tone } = outcome === "moved" ? APPROVE_FLASH.moved : done;
    flash(c, message, tone);
    return hxRedirect(c, "/admin/git");
  }
  const coverage = await coverageOf(row);
  const body = <ApproveLinkBody link={view} coverage={coverage} target={targetOf(c)} />;
  return await answer(c, approveTitle(view), body, 409);
}

/**
 * Approve what the dialog showed: a link edited since is still pending with the same id, so the
 * post carries the row's `updatedAt` and a different one means it moved.
 */
async function approveShown(
  c: Context,
  row: GitRepositoryLinkRow,
): Promise<"approved" | "moved" | "refused"> {
  const seen = (await c.req.parseBody())["updatedAt"];
  return seen === row.updatedAt ? await approve(row) : "moved";
}

/** Approve the link: approved, moved by someone else, or refused (not covered, or no answer). */
async function approve(row: GitRepositoryLinkRow): Promise<"approved" | "moved" | "refused"> {
  const { db, logger, buildState, user } = getStore();
  const deps = {
    db,
    logger,
    gitConnections: gitConnectionModel(),
    publisher: buildState ?? { request: requestBuildState },
  };
  try {
    const result = await approveRepositoryLink(deps, row.id, user?.id ?? null);
    return result.approved ? "approved" : "refused";
  } catch (error) {
    if (error instanceof GitLinkStateError) {
      return "moved";
    }
    const reason = error instanceof HttpError ? `HTTP ${error.status}` : "no answer";
    logger.warn({ linkId: row.id, reason }, "link approval inconclusive");
    return "refused";
  }
}

async function handleRefuseDialog(c: Context): Promise<Response> {
  const { view } = await openLink(c);
  if (view.state !== "pending") {
    notFound("Only a pending link is refused");
  }
  return await answer(
    c,
    "Refuse repository link",
    <RefuseLinkBody link={view} target={targetOf(c)} />,
  );
}

async function handleRefuse(c: Context): Promise<Response> {
  const { row, view } = await openLink(c);
  const posted = (await c.req.parseBody())["reason"];
  const reason = typeof posted === "string" ? posted.trim() : "";
  if (reason.length > REASON_MAX) {
    const error = `At most ${REASON_MAX} characters`;
    const body = <RefuseLinkBody link={view} target={targetOf(c)} error={error} />;
    return await answer(c, "Refuse repository link", body, 422);
  }
  const refused = await refuse(row.id, reason);
  flash(
    c,
    refused ? `${view.repository} refused` : "That link changed meanwhile; nothing was refused",
    refused ? "success" : "warning",
  );
  return hxRedirect(c, "/admin/git");
}

/** Refuse a pending link; false when it moved meanwhile. */
async function refuse(id: string, reason: string): Promise<boolean> {
  try {
    await new GitRepositoryLinkModel(getStore().db).refuse(id, reason || null);
    return true;
  } catch (error) {
    if (!(error instanceof GitLinkStateError)) throw error;
    return false;
  }
}
