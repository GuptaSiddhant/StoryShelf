import { z } from "zod";
import { buildPath, projectSlug, type ToolDef } from "./types.ts";

const project = z.string().optional().describe("Project slug (defaults to STORYSHELF_SLUG)");

export const getBuildInsight: ToolDef = {
  name: "get_build_insight",
  title: "Get build AI triage",
  description:
    "Get the latest cached AI triage of a build: verdict (likely-intended, needs-review, likely-regression), summary and per-snapshot notes. Advisory only. Read-only: it never triggers generation (an approver does that in the UI).",
  readOnly: true,
  input: { project, buildId: z.string().describe("Build id (ULID)") },
  run: async (client, args) => await client.get(`${buildPath(client, args)}/insights/latest`),
};

export const getProjectHealth: ToolDef = {
  name: "get_project_health",
  title: "Get project health",
  description:
    "Get the latest cached AI project-health digest (verdict, 0-100 score, trends) for a project. Read-only.",
  readOnly: true,
  input: { project, window: z.string().optional().describe("Window, e.g. 30d") },
  run: async (client, args) =>
    await client.get(`/projects/${projectSlug(client, args["project"])}/insights/health`, {
      window: args["window"] as string | undefined,
    }),
};

export const insightTools: ToolDef[] = [getBuildInsight, getProjectHealth];
