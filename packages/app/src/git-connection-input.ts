/**
 * Reading the add-connection form (ADR 0054, decision 1). Each option is validated on its own
 * (`parseOptionFields`), and checked with the same constructors configuration uses (`githubApp`,
 * `gitlabGroup`), so a stored connection passes the rules a configured one does. Messages never
 * repeat a key or a token.
 */
import { githubApp, gitlabGroup, manifestFormUrl } from "@storyshelf/core/integrations";
import type { GitConnectionInput } from "@storyshelf/core/models";
import { z } from "zod";
import type { ConnectionKind } from "./pages/git-connection-form.tsx";
import { parseOptionFields } from "./ui/components.tsx";

const text = z.string().optional();

/** The fields of each option; a field of another option is refused. */
const SCHEMAS = {
  "github-manifest": z.object({
    gh_name: text,
    gh_org: text,
    gh_api: text,
    gh_comment: text,
    gh_statuses: text,
  }),
  "github-app": z.object({
    app_name: text,
    app_id: text,
    app_key: text,
    app_api: text,
    app_comment: text,
    app_statuses: text,
  }),
  "gitlab-token": z.object({
    gl_host: text,
    gl_group: text,
    gl_name: text,
    gl_token: text,
    gl_expires: text,
    gl_comment: text,
  }),
};

/** Longest App name GitHub accepts. */
const APP_NAME_MAX = 34;
const GROUP_PATTERN = /^[\w.-]+(?:\/[\w.-]+)*$/u;

/** What a Connect GitHub request remembers until GitHub returns (no secret). */
export interface ManifestRequest {
  name: string;
  organization: string;
  apiUrl: string;
  comment: boolean;
  statuses: boolean;
}

/** The outcome of a post: a connection to store, a manifest flow to start, or the form again. */
export type ConnectionPost =
  | { kind: "store"; input: Omit<GitConnectionInput, "createdBy"> }
  | { kind: "manifest"; request: ManifestRequest }
  | { kind: "form"; selected: ConnectionKind; errors: Record<string, string>; prepared: boolean };

type Fields = Record<string, string | undefined>;

const field = (fields: Fields, name: string): string => fields[name]?.trim() ?? "";
const on = (fields: Fields, name: string): boolean => fields[name] === "on";

/** Read a post of the form; `prepare` asks only for GitLab's prefilled link. */
export function readConnectionPost(body: Record<string, unknown>): ConnectionPost {
  const parsed = parseOptionFields<Fields & { kind: ConnectionKind }>(body, "kind", SCHEMAS);
  if (!parsed.ok) {
    return {
      kind: "form",
      selected: "github-manifest",
      errors: { form: parsed.error },
      prepared: false,
    };
  }
  const { kind } = parsed.value;
  if (kind === "github-manifest") {
    return manifestPost(parsed.value);
  }
  if (kind === "github-app") {
    return existingAppPost(parsed.value);
  }
  return body["intent"] === "prepare" ? gitlabPrepare(parsed.value) : gitlabPost(parsed.value);
}

function formErrors(selected: ConnectionKind, errors: Record<string, string>): ConnectionPost {
  return { kind: "form", selected, errors, prepared: false };
}

function manifestPost(fields: Fields): ConnectionPost {
  const request: ManifestRequest = {
    name: field(fields, "gh_name") || "StoryShelf",
    organization: field(fields, "gh_org"),
    apiUrl: field(fields, "gh_api"),
    comment: on(fields, "gh_comment"),
    statuses: on(fields, "gh_statuses"),
  };
  const errors: Record<string, string> = {};
  if (request.name.length > APP_NAME_MAX) {
    errors["gh_name"] = `At most ${APP_NAME_MAX} characters`;
  }
  if (request.apiUrl !== "" && !isHttpUrl(request.apiUrl)) {
    errors["gh_api"] = "Enter the API URL, e.g. https://ghes.example.com/api/v3";
  }
  try {
    manifestFormUrl({ state: "check", organization: request.organization });
  } catch {
    errors["gh_org"] = "Not a GitHub organization name";
  }
  return Object.keys(errors).length > 0
    ? formErrors("github-manifest", errors)
    : { kind: "manifest", request };
}

function existingAppPost(fields: Fields): ConnectionPost {
  const apiUrl = field(fields, "app_api");
  if (apiUrl !== "" && !isHttpUrl(apiUrl)) {
    return formErrors("github-app", {
      app_api: "Enter the API URL, e.g. https://ghes.example.com/api/v3",
    });
  }
  if (!/^\d+$/u.test(field(fields, "app_id"))) {
    return formErrors("github-app", { app_id: "The App ID is a number" });
  }
  try {
    const app = githubApp({
      id: "new",
      appId: field(fields, "app_id"),
      privateKey: fields["app_key"] ?? "",
      apiUrl: apiUrl || undefined,
      name: field(fields, "app_name") || "GitHub App",
      posts: { pullRequests: on(fields, "app_comment"), statuses: on(fields, "app_statuses") },
    });
    return { kind: "store", input: storedInput(app) };
  } catch {
    // The constructor names the field, never the key; the only field left to fail is the key.
    return formErrors("github-app", { app_key: "Paste the App's PEM private key" });
  }
}

function gitlabPrepare(fields: Fields): ConnectionPost {
  const errors = gitlabTargetErrors(fields);
  if (field(fields, "gl_group") === "") {
    errors["gl_group"] = "Enter the group the token is for";
  }
  return {
    kind: "form",
    selected: "gitlab-token",
    errors,
    prepared: Object.keys(errors).length === 0,
  };
}

function gitlabPost(fields: Fields): ConnectionPost {
  const errors = gitlabTargetErrors(fields);
  if (field(fields, "gl_token") === "") {
    errors["gl_token"] = "Paste the group or project access token";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(field(fields, "gl_expires"))) {
    errors["gl_expires"] = "Enter the date the token expires";
  }
  if (Object.keys(errors).length > 0) {
    return {
      kind: "form",
      selected: "gitlab-token",
      errors,
      prepared: field(fields, "gl_group") !== "",
    };
  }
  const connection = gitlabGroup({
    id: "new",
    host: field(fields, "gl_host"),
    token: field(fields, "gl_token"),
    expiresOn: field(fields, "gl_expires"),
    name: field(fields, "gl_name") || "GitLab",
  });
  const group = field(fields, "gl_group");
  return {
    kind: "store",
    input: storedInput(connection, {
      ...(group ? { group } : {}),
      posts: { pullRequests: on(fields, "gl_comment") },
    }),
  };
}

function gitlabTargetErrors(fields: Fields): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!isHttpUrl(field(fields, "gl_host"))) {
    errors["gl_host"] = "Enter GitLab's address, e.g. https://gitlab.com";
  }
  const group = field(fields, "gl_group");
  if (group !== "" && !GROUP_PATTERN.test(group)) {
    errors["gl_group"] = "Enter the group's path, e.g. acme/web";
  }
  return errors;
}

/** GitLab's form for a new group access token, prefilled with a name and the `api` scope. */
export function gitlabTokenUrl(host: string, group: string): string {
  const url = new URL(`/groups/${group}/-/settings/access_tokens`, new URL(host).origin);
  url.searchParams.set("name", "StoryShelf");
  url.searchParams.set("scopes", "api");
  return url.toString();
}

/** A validated connection as the database stores it: its secret is read here once, to be encrypted. */
function storedInput(
  connection: ReturnType<typeof githubApp>,
  extra: Record<string, unknown> = {},
): Omit<GitConnectionInput, "createdBy"> {
  return {
    provider: connection.provider,
    name: connection.name,
    apiBase: connection.apiBase,
    config: { ...connection.config, ...extra },
    secret: connection.readSecret(),
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
