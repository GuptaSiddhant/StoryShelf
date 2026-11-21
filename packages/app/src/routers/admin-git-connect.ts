/**
 * Adding a server-wide git connection (ADR 0054, decisions 1 and 5). An existing App or a GitLab
 * token is stored from the form. Connect GitHub posts a manifest to GitHub: the start post issues a
 * single-use, session-bound, ten-minute `state` (`GitSetupStateModel`); GitHub's return `GET` only
 * shows a confirm page, and the confirming post (CSRF-protected) spends the state and exchanges the
 * one-time `code`. Every URL GitHub sees is built from the confirmed public origin; with none the
 * flow does not start. The `code` and the `state` are never logged, and the private key goes
 * straight from GitHub's answer into the encrypted column.
 */
import {
  exchangeManifestCode,
  githubAppManifest,
  manifestFormUrl,
  type ExchangedApp,
} from "@storyshelf/core/integrations";
import {
  GitSetupStateModel,
  type GitConnection,
  type GitSetupPayload,
} from "@storyshelf/core/models";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { confirmedOrigin, gitConnectionModel } from "../git-admin.ts";
import {
  gitlabTokenUrl,
  readConnectionPost,
  type ConnectionPost,
  type ManifestRequest,
} from "../git-connection-input.ts";
import {
  CONNECTION_KINDS,
  renderGitConnectionForm,
  type GitConnectionFormData,
} from "../pages/git-connection-form.tsx";
import {
  renderGitHubConfirmPage,
  renderGitHubContinuePage,
  renderGitHubFlowEnded,
  type GitHubAppChoice,
} from "../pages/git-github-flow.tsx";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { requireSiteAdmin } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";

/** Where GitHub returns, and the hook URL a manifest must name (StoryShelf takes no webhooks). */
export const GITHUB_RETURN_PATH = "/admin/git/github/return";
const NO_WEBHOOK_PATH = "/admin/git/github/no-webhooks";

/** Fields never echoed back into a re-rendered form. */
const SECRET_FIELDS = new Set(["app_key", "gl_token", "csrf", "intent"]);

/** Register the add-connection page and the GitHub return. */
export function registerGitConnect(app: ShelfRouter): void {
  app.get("/admin/git/connections/new", handleNew);
  app.post("/admin/git/connections", handleCreate);
  app.get(GITHUB_RETURN_PATH, handleReturn);
  app.post("/admin/git/github/confirm", handleConfirm);
}

async function handleNew(c: Context): Promise<Response> {
  requireSiteAdmin(c);
  const asked = c.req.query("kind");
  const kind = CONNECTION_KINDS.find((candidate) => candidate === asked) ?? "github-manifest";
  return c.html(
    renderGitConnectionForm({ kind, values: {}, errors: {}, origin: await confirmedOrigin() }),
  );
}

async function handleCreate(c: Context): Promise<Response> {
  requireSiteAdmin(c);
  const body = await c.req.parseBody();
  const post = readConnectionPost(body);
  if (post.kind === "form") {
    return await renderForm(c, post, body);
  }
  if (post.kind === "manifest") {
    return await startManifestFlow(c, post.request, body);
  }
  const connection = await gitConnectionModel().create({
    ...post.input,
    createdBy: getStore().user?.id ?? null,
  });
  flash(c, `${connection.name} connected`);
  return hxRedirect(c, "/admin/git");
}

/** The form again: errors (422), or GitLab's prefilled link once its host and group are known. */
async function renderForm(
  c: Context,
  post: Extract<ConnectionPost, { kind: "form" }>,
  body: Record<string, unknown>,
): Promise<Response> {
  const values = echoValues(body);
  const data: GitConnectionFormData = {
    kind: post.selected,
    values,
    errors: post.errors,
    origin: await confirmedOrigin(),
    gitlabTokenUrl: post.prepared
      ? gitlabTokenUrl(values["gl_host"] ?? "", values["gl_group"] ?? "")
      : undefined,
  };
  return c.html(renderGitConnectionForm(data), post.prepared ? 200 : 422);
}

/** Typed values to show again: strings only, never a key or a token. */
function echoValues(body: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(body).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && !SECRET_FIELDS.has(entry[0]),
    ),
  );
}

/** Issue the state and hand the browser the manifest to post to GitHub. */
async function startManifestFlow(
  c: Context,
  request: ManifestRequest,
  body: Record<string, unknown>,
): Promise<Response> {
  const origin = await confirmedOrigin();
  if (origin === null) {
    return await renderForm(
      c,
      {
        kind: "form",
        selected: "github-manifest",
        errors: { form: "Confirm the server's public origin first: GitHub returns to it." },
        prepared: false,
      },
      body,
    );
  }
  const { db, sessionId } = getStore();
  const state = await new GitSetupStateModel(db).issue(sessionId, { ...request });
  const manifest = githubAppManifest({
    name: request.name,
    homepageUrl: origin,
    redirectUrl: `${origin}${GITHUB_RETURN_PATH}`,
    webhookUrl: `${origin}${NO_WEBHOOK_PATH}`,
    posts: { pullRequests: request.comment, statuses: request.statuses },
  });
  c.header("Cache-Control", "no-store");
  return c.html(
    renderGitHubContinuePage({
      formUrl: manifestFormUrl({
        state,
        organization: request.organization,
        apiUrl: request.apiUrl || undefined,
      }),
      manifest: JSON.stringify(manifest),
      choice: choiceOf(request),
    }),
  );
}

/** The flow's own pages carry a state or a code: never cached, never sent on as a referrer. */
function privatePage(c: Context): void {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
}

/** GitHub's return: check the state, then ask the site admin to confirm. Writes nothing. */
async function handleReturn(c: Context): Promise<Response> {
  requireSiteAdmin(c);
  privatePage(c);
  const state = c.req.query("state") ?? "";
  const payload = await new GitSetupStateModel(getStore().db).peek(state, getStore().sessionId);
  const code = c.req.query("code") ?? "";
  if (payload === null || !CODE_PATTERN.test(code)) {
    const message = payload === null ? ENDED_MESSAGE : "GitHub came back without creating an App.";
    return c.html(renderGitHubFlowEnded({ message }), 400);
  }
  return c.html(renderGitHubConfirmPage({ state, code, choice: choiceOf(requestOf(payload)) }));
}

const CODE_PATTERN = /^[\w-]{1,200}$/u;

const ENDED_MESSAGE =
  "It expired, was already used, or was started in another browser session. Each setup is valid for ten minutes, once.";

/** A posted field as text; anything else (a file) is empty. */
function formText(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

/** The confirming post: spend the state, exchange the code, store the App's key encrypted. */
async function handleConfirm(c: Context): Promise<Response> {
  requireSiteAdmin(c);
  privatePage(c);
  const outcome = await confirmApp(await c.req.parseBody());
  if ("status" in outcome) {
    return c.html(renderGitHubFlowEnded({ message: outcome.message }), outcome.status);
  }
  flash(c, `${outcome.name} connected. Install it on the repositories projects will link.`);
  return hxRedirect(c, "/admin/git");
}

/** The stored connection, or why the flow ended here. */
async function confirmApp(
  body: Record<string, unknown>,
): Promise<GitConnection | { status: 400 | 502; message: string }> {
  const request = await spendState(formText(body, "state"));
  if (request === null) {
    return { status: 400, message: ENDED_MESSAGE };
  }
  const app = await exchange(formText(body, "code"), request);
  return typeof app === "string"
    ? { status: 502, message: `${app}. Start again.` }
    : await storeApp(app, request);
}

/** Spend this session's state once; null when it is not live. */
async function spendState(state: string): Promise<ManifestRequest | null> {
  const { db, sessionId } = getStore();
  const payload = await new GitSetupStateModel(db).consume(state, sessionId);
  return payload === null ? null : requestOf(payload);
}

/** The App, or why GitHub did not exchange the code (an HTTP status at most, never the code). */
async function exchange(code: string, request: ManifestRequest): Promise<ExchangedApp | string> {
  try {
    return await exchangeManifestCode(code, request.apiUrl || undefined);
  } catch (error) {
    // The message names an HTTP status only; the cause, whose URL holds the code, is dropped.
    const reason = error instanceof Error ? error.message : "The exchange failed";
    getStore().logger.warn({ reason }, "GitHub App manifest exchange failed");
    return reason;
  }
}

async function storeApp(app: ExchangedApp, request: ManifestRequest): Promise<GitConnection> {
  return await gitConnectionModel().create({
    provider: "github-app",
    name: app.name,
    apiBase: request.apiUrl ? request.apiUrl.replace(/\/+$/u, "") : null,
    config: {
      appId: app.appId,
      slug: app.slug,
      owner: app.owner,
      htmlUrl: app.htmlUrl,
      posts: { pullRequests: request.comment, statuses: request.statuses },
    },
    secret: app.privateKey,
    createdBy: getStore().user?.id ?? null,
  });
}

/** A stored payload back as the request it was made from. */
function requestOf(payload: GitSetupPayload): ManifestRequest {
  const text = (key: string): string => {
    const value = payload[key];
    return typeof value === "string" ? value : "";
  };
  return {
    name: text("name"),
    organization: text("organization"),
    apiUrl: text("apiUrl"),
    comment: payload["comment"] === true,
    statuses: payload["statuses"] === true,
  };
}

function choiceOf(request: ManifestRequest): GitHubAppChoice {
  return {
    name: request.name,
    organization: request.organization,
    apiUrl: request.apiUrl,
    permissions: [
      "Checks: write",
      "Contents: read (compare only)",
      ...(request.comment ? ["Pull requests: write"] : []),
      ...(request.statuses ? ["Commit statuses: write"] : []),
    ],
  };
}
