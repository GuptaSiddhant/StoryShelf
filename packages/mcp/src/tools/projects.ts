import { z } from "zod";
import { ToolError, type ApiClient } from "../client.ts";
import { projectSlug, type ToolDef } from "./types.ts";

const project = z.string().optional().describe("Project slug (defaults to SHELF_SLUG)");

const CANNOT_LIST =
  "A project token cannot list projects. Set SHELF_SLUG to the token's project to read it, or use a site-admin token to list them.";

export const listProjects: ToolDef = {
  name: "list_projects",
  title: "List projects",
  description:
    "List StoryShelf projects (one per Storybook). A site-admin token lists them all; a project token gets its own project (when SHELF_SLUG names it) and otherwise cannot list.",
  readOnly: true,
  input: {},
  run: async (client) => {
    try {
      const projects = await client.get<Record<string, unknown>[]>("/projects");
      return projects.map((row) => summary(row));
    } catch (error) {
      if (!(error instanceof ToolError) || error.status !== 403) {
        throw error;
      }
      return await ownProject(client);
    }
  },
};

/** The one project a project token may read: `SHELF_SLUG` names it. Otherwise the token cannot list. */
async function ownProject(client: ApiClient): Promise<Record<string, unknown>[]> {
  const slug = client.defaultSlug;
  if (!slug) {
    throw new ToolError(CANNOT_LIST, 403);
  }
  try {
    const own = await client.get<Record<string, unknown>>(`/projects/${encodeURIComponent(slug)}`);
    return [summary(own)];
  } catch {
    throw new ToolError(CANNOT_LIST, 403);
  }
}

function summary(source: Record<string, unknown>): Record<string, unknown> {
  return pick(source, ["name", "slug", "gitRepository", "gitDefaultBranch"]);
}

export const getProject: ToolDef = {
  name: "get_project",
  title: "Get project",
  description:
    "Get a project's settings: default branch, diff thresholds, browser, play-function setting, and whether accessibility checks run (`runA11y`; axe findings are information only and never block a build).",
  readOnly: true,
  input: { project },
  run: async (client, args) =>
    await client.get(`/projects/${projectSlug(client, args["project"])}`),
};

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

export const projectTools: ToolDef[] = [listProjects, getProject];
