/**
 * Moving a per-project git channel on System → Git (ADR 0054, decision 8). The dialog shows the
 * channel and the connections that can take it over; the post checks coverage and replaces the
 * channel with an approved link in one transaction (`moveGitChannel`), or leaves it unchanged and
 * says why. Site-admin pages classed `hosting`, writes under `CSRF_PATHS` (`/admin/git/*`). An
 * answer names a status or a reason, never the channel's token or key.
 */
import { moveGitChannel, type ChannelMoveTarget } from "@storyshelf/core/build-state";
import {
  GitChannelChangedError,
  GitRepositoryTakenError,
  perProjectGitChannelOf,
  ProjectModel,
} from "@storyshelf/core/models";
import { HttpError } from "@storyshelf/core/utils";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { gitConnectionModel, installUrlOf } from "../git-admin.ts";
import { channelView } from "../git-channels-admin.ts";
import { requestBuildState } from "../git-status.ts";
import {
  CHANNEL_DIALOG_ID,
  FROM_CHANNEL,
  type GitChannelMoveProblem,
  type GitChannelView,
} from "../pages/admin-git-channels.tsx";
import { MoveChannelBody } from "../pages/git-channel-dialogs.tsx";
import { renderLinkDialogPage } from "../pages/git-link-dialogs.tsx";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { notFound, requireSiteAdmin } from "./helpers.ts";
import { hxRedirect, isHxRequest } from "./htmx.ts";
import { notificationChannelModel } from "./scoped-models.ts";

const TITLE = "Move git channel";

/** Register the move dialog and its post. */
export function registerGitChannelMoves(app: ShelfRouter): void {
  app.get("/admin/git/channels/:id/move", handleDialog);
  app.post("/admin/git/channels/:id/move", handleMove);
}

const inDialog = (c: Context): boolean =>
  isHxRequest(c) && c.req.header("HX-Target") === `${CHANNEL_DIALOG_ID}-body`;

const targetOf = (c: Context): string => (inDialog(c) ? `#${CHANNEL_DIALOG_ID}-body` : "body");

/** The channel's view, or 404 for anything but a project's git channel. */
async function openChannel(c: Context): Promise<GitChannelView> {
  requireSiteAdmin(c);
  const row = await notificationChannelModel().get(c.req.param("id") ?? "");
  const channel = row === null ? null : perProjectGitChannelOf(row);
  if (channel === null) {
    notFound("No per-project git channel with that id");
  }
  const connections = await gitConnectionModel().list();
  const projects = await new ProjectModel(getStore().db).list();
  return channelView(channel, connections, projects);
}

function answer(
  c: Context,
  view: GitChannelView,
  extra: { problem?: GitChannelMoveProblem; selected?: string } = {},
  status: 200 | 409 | 422 = 200,
): Response | Promise<Response> {
  const body = <MoveChannelBody channel={view} target={targetOf(c)} {...extra} />;
  return inDialog(c) ? c.html(body, status) : c.html(renderLinkDialogPage(TITLE, body), status);
}

async function handleDialog(c: Context): Promise<Response> {
  return await answer(c, await openChannel(c));
}

async function handleMove(c: Context): Promise<Response> {
  const view = await openChannel(c);
  const { picked, updatedAt } = readPost(await c.req.parseBody());
  if (picked === "") {
    return await answer(c, view, { problem: { kind: "unfit" } }, 422);
  }
  const outcome = await move(view, picked, updatedAt);
  if (outcome.kind === "problem") {
    return await answer(c, view, { problem: outcome.problem, selected: picked }, 409);
  }
  const moved = outcome.kind === "moved";
  flash(
    c,
    moved
      ? `${view.repository} moved to ${outcome.connection}`
      : "That channel changed meanwhile; nothing was moved",
    moved ? "success" : "warning",
  );
  return hxRedirect(c, "/admin/git");
}

/** The connection picked and the `updatedAt` the dialog carried. */
function readPost(form: Record<string, unknown>): { picked: string; updatedAt: string } {
  const text = (key: string): string => {
    const value = form[key];
    return typeof value === "string" ? value : "";
  };
  return { picked: text("connection"), updatedAt: text("updatedAt") };
}

type MoveOutcome =
  | { kind: "moved"; connection: string }
  | { kind: "changed" }
  | { kind: "problem"; problem: GitChannelMoveProblem };

/** Run the move; every way it does not happen leaves the channel as it was. */
async function move(view: GitChannelView, picked: string, updatedAt: string): Promise<MoveOutcome> {
  const { db, logger, buildState, user } = getStore();
  const target: ChannelMoveTarget =
    picked === FROM_CHANNEL ? { fromChannel: true } : { connectionId: picked };
  const deps = {
    db,
    logger,
    gitConnections: gitConnectionModel(),
    publisher: buildState ?? { request: requestBuildState },
    channels: notificationChannelModel(),
  };
  try {
    const result = await moveGitChannel(deps, {
      channelId: view.id,
      updatedAt,
      target,
      movedBy: user?.id ?? null,
    });
    return result.moved
      ? { kind: "moved", connection: result.connection.name }
      : { kind: "problem", problem: await problemOf(result.reason, picked) };
  } catch (error) {
    return failureOf(error, view.id);
  }
}

async function problemOf(
  reason: "not-covered" | "unfit" | "needs-app" | "bad-key",
  picked: string,
): Promise<GitChannelMoveProblem> {
  if (reason !== "not-covered") {
    return { kind: reason === "bad-key" ? "bad-key" : "unfit" };
  }
  const connection = picked === FROM_CHANNEL ? null : await gitConnectionModel().get(picked);
  return { kind: "not-covered", installUrl: connection ? installUrlOf(connection) : undefined };
}

/** A moved or taken channel, or an inconclusive host; anything else is a real failure. */
function failureOf(error: unknown, channelId: string): MoveOutcome {
  if (error instanceof GitChannelChangedError) {
    return { kind: "changed" };
  }
  if (error instanceof GitRepositoryTakenError) {
    return { kind: "problem", problem: { kind: "taken" } };
  }
  if (error instanceof HttpError || isNetworkError(error)) {
    const detail = error instanceof HttpError ? `HTTP ${error.status}` : "no answer";
    getStore().logger.warn({ channelId, reason: detail }, "git channel move inconclusive");
    return { kind: "problem", problem: { kind: "unreachable", detail } };
  }
  throw error;
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && error.name === "AbortError");
}
