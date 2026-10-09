import { z } from "zod";
import { projectSlug, type ToolDef } from "./types.ts";

const project = z.string().optional().describe("Project slug (defaults to STORYSHELF_SLUG)");

export const listProjects: ToolDef = {
  name: "list_projects",
  title: "List projects",
  description:
    "List StoryShelf projects (one per Storybook). Needs a site-admin token; with a project token use get_project instead.",
  readOnly: true,
  input: {},
  run: async (client) => {
    const projects = await client.get<Record<string, unknown>[]>("/projects");
    return projects.map((p) => pick(p, ["name", "slug", "gitRepository", "gitDefaultBranch"]));
  },
};

export const getProject: ToolDef = {
  name: "get_project",
  title: "Get project",
  description:
    "Get a project's settings: default branch, diff thresholds, browser, play-function setting.",
  readOnly: true,
  input: { project },
  run: async (client, args) =>
    await client.get(`/projects/${projectSlug(client, args["project"])}`),
};

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

export const projectTools: ToolDef[] = [listProjects, getProject];
