import { z } from "zod";
import { buildPath, type ToolDef } from "./types.ts";

const SNAPSHOT_FIELDS = [
  "id",
  "storyId",
  "storyTitle",
  "storyName",
  "viewportName",
  "status",
  "diffPixels",
  "diffRatio",
  "diffPassed",
  "inherited",
  "reviewedBy",
] as const;

export const listSnapshots: ToolDef = {
  name: "list_snapshots",
  title: "List snapshots",
  description:
    "List the story snapshots of a build with diff metrics (pixels, ratio, pass/fail) and review status. By default only changed/new/pending/rejected snapshots are returned; set includeUnchanged for all. Approving is intentionally not available: a human approves in the StoryShelf UI.",
  readOnly: true,
  input: {
    project: z.string().optional().describe("Project slug (defaults to STORYSHELF_SLUG)"),
    buildId: z.string().describe("Build id (ULID)"),
    includeUnchanged: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(100),
  },
  run: async (client, args) => {
    const all = await client.get<Record<string, unknown>[]>(`${buildPath(client, args)}/snapshots`);
    const wanted = args["includeUnchanged"]
      ? all
      : all.filter((s) => s["status"] !== "unchanged" && s["status"] !== "approved");
    const limit = Number(args["limit"] ?? 100);
    return {
      total: all.length,
      returned: Math.min(wanted.length, limit),
      snapshots: wanted
        .slice(0, limit)
        .map((s) => Object.fromEntries(SNAPSHOT_FIELDS.map((key) => [key, s[key]]))),
    };
  },
};

export const snapshotTools: ToolDef[] = [listSnapshots];
