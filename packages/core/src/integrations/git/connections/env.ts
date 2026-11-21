/**
 * Git connections from the server's environment (ADR 0054, decision 9), beside `smtpPresetFromEnv`:
 * one GitHub App, one GitLab connection, and more through `SHELF_GIT_CONFIG_FILE`.
 *
 * A secret comes from its variable or from the file its `…_FILE` variable names (the way container
 * secrets are mounted), never both. Errors name the variable, never its value.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { assertGitOptions, githubApp, gitlabGroup } from "./define.ts";
import type { ConfiguredGitConnection, GitLinkConfig, ShelfGitOptions } from "./types.ts";

type Env = Record<string, string | undefined>;
type ReadFile = (path: string) => string;

/** Id of the GitHub App connection the environment declares. */
export const ENV_GITHUB_CONNECTION_ID = "github";
/** Id of the GitLab connection the environment declares. */
export const ENV_GITLAB_CONNECTION_ID = "gitlab";

/**
 * The connections and links the environment declares; empty when none is set. Throws at startup on
 * a half-configured connection, so a missing key never turns into a silently missing merge gate.
 */
export function gitFromEnv(
  env: Env = process.env,
  readFile: ReadFile = (path) => readFileSync(path, "utf8"),
): ShelfGitOptions {
  const fromFile = env["SHELF_GIT_CONFIG_FILE"]
    ? gitConfigFile(readFile(env["SHELF_GIT_CONFIG_FILE"]), readFile)
    : { connections: [], links: [] };
  const options: Required<ShelfGitOptions> = {
    connections: [
      ...githubFromEnv(env, readFile),
      ...gitlabFromEnv(env, readFile),
      ...fromFile.connections,
    ],
    links: fromFile.links,
  };
  assertGitOptions(options);
  return options;
}

function githubFromEnv(env: Env, readFile: ReadFile): ConfiguredGitConnection[] {
  const appId = env["SHELF_GITHUB_APP_ID"];
  const privateKey = secretOf(env, "SHELF_GITHUB_APP_PRIVATE_KEY", readFile);
  if (!appId && privateKey === undefined) {
    return [];
  }
  if (!appId || privateKey === undefined) {
    throw new TypeError(
      "Set both SHELF_GITHUB_APP_ID and SHELF_GITHUB_APP_PRIVATE_KEY (or SHELF_GITHUB_APP_PRIVATE_KEY_FILE)",
    );
  }
  const apiUrl = nonEmpty(env["SHELF_GITHUB_API_URL"]);
  return [githubApp({ id: ENV_GITHUB_CONNECTION_ID, appId, privateKey, apiUrl })];
}

function gitlabFromEnv(env: Env, readFile: ReadFile): ConfiguredGitConnection[] {
  const token = secretOf(env, "SHELF_GITLAB_TOKEN", readFile);
  if (token === undefined) {
    return [];
  }
  const expiresOn = env["SHELF_GITLAB_TOKEN_EXPIRES"];
  if (!expiresOn) {
    throw new TypeError("SHELF_GITLAB_TOKEN needs SHELF_GITLAB_TOKEN_EXPIRES (YYYY-MM-DD)");
  }
  const host = nonEmpty(env["SHELF_GITLAB_HOST"]) ?? "https://gitlab.com";
  return [gitlabGroup({ id: ENV_GITLAB_CONNECTION_ID, host, token, expiresOn })];
}

/** `NAME` or the contents of the file `NAME_FILE` names; undefined when neither is set. */
function secretOf(env: Env, name: string, readFile: ReadFile): string | undefined {
  const value = env[name];
  const file = env[`${name}_FILE`];
  if (value && file) {
    throw new TypeError(`Set ${name} or ${name}_FILE, not both`);
  }
  return file ? readFile(file) : nonEmpty(value);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

const optionalText = z.string().optional();
const secretFile = z.string().min(1).optional();
const postsSchema = z.object({
  pullRequests: z.boolean().optional(),
  statuses: z.boolean().optional(),
});
const githubEntry = z.object({
  provider: z.literal("github-app"),
  id: z.string(),
  name: optionalText,
  appId: z.union([z.string(), z.number()]),
  privateKey: optionalText,
  privateKeyFile: secretFile,
  apiUrl: optionalText,
  posts: postsSchema.optional(),
});
const gitlabEntry = z.object({
  provider: z.literal("gitlab-token"),
  id: z.string(),
  name: optionalText,
  host: z.string().default("https://gitlab.com"),
  token: optionalText,
  tokenFile: secretFile,
  expiresOn: z.string(),
});
const linkEntry = z.object({
  connection: z.string(),
  project: z.string(),
  repository: z.string(),
  prefix: optionalText,
});
const connectionsSchema = z.array(z.discriminatedUnion("provider", [githubEntry, gitlabEntry]));
const fileSchema = z.object({
  connections: connectionsSchema.default([]),
  links: z.array(linkEntry).default([]),
});

/** Parse `SHELF_GIT_CONFIG_FILE`: the `git` option's shape, with each secret inline or as a `…File` path. */
export function gitConfigFile(
  text: string,
  readFile: ReadFile,
): { connections: ConfiguredGitConnection[]; links: GitLinkConfig[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new TypeError("SHELF_GIT_CONFIG_FILE is not valid JSON");
  }
  const parsed = fileSchema.safeParse(json);
  if (!parsed.success) {
    // Zod issues name the path and the expected type, never the value.
    const where = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new TypeError(`SHELF_GIT_CONFIG_FILE has invalid fields: ${where}`);
  }
  const connections = parsed.data.connections.map((entry) => {
    if (entry.provider === "github-app") {
      const privateKey = inlineOrFile(entry.id, entry.privateKey, entry.privateKeyFile, readFile);
      return githubApp({ ...entry, privateKey });
    }
    const token = inlineOrFile(entry.id, entry.token, entry.tokenFile, readFile);
    return gitlabGroup({ ...entry, token });
  });
  return { connections, links: parsed.data.links };
}

function inlineOrFile(
  id: string,
  inline: string | undefined,
  file: string | undefined,
  readFile: ReadFile,
): string {
  if ((inline === undefined) === (file === undefined)) {
    throw new TypeError(
      `git connection "${id}" needs exactly one of its secret or its secret file`,
    );
  }
  return file === undefined ? (inline ?? "") : readFile(file);
}
