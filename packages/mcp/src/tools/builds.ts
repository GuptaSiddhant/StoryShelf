import { z } from "zod";
import { buildPath, projectSlug, type ToolDef } from "./types.ts";

const project = z.string().optional().describe("Project slug (defaults to STORYSHELF_SLUG)");
const buildId = z.string().describe("Build id (ULID)");
const BUILD_FIELDS = [
  "id",
  "gitSha",
  "gitBranch",
  "isDefault",
  "message",
  "authorName",
  "status",
  "snapshotCount",
  "changedCount",
  "approvedCount",
  "rejectedCount",
  "createdAt",
] as const;

export const listBuilds: ToolDef = {
  name: "list_builds",
  title: "List builds",
  description:
    "List recent builds of a project, newest first, with change counts. Filter by branch or status.",
  readOnly: true,
  input: {
    project,
    branch: z.string().optional().describe("Only builds on this git branch"),
    status: z
      .enum(["pending", "capturing", "comparing", "reviewing", "approved", "rejected", "failed"])
      .optional(),
    limit: z.number().int().min(1).max(100).default(20).describe("Max builds to return"),
  },
  run: async (client, args) => {
    const builds = await client.get<Record<string, unknown>[]>(
      `/projects/${projectSlug(client, args["project"])}/builds`,
      {
        branch: args["branch"] as string | undefined,
        status: args["status"] as string | undefined,
      },
    );
    const limit = Number(args["limit"] ?? 20);
    return builds.slice(0, limit).map((b) => pickFields(b, BUILD_FIELDS));
  },
};

export const getBuild: ToolDef = {
  name: "get_build",
  title: "Get build",
  description:
    "Get one build: status, git info, snapshot/changed/approved/rejected counts, baseline.",
  readOnly: true,
  input: { project, buildId },
  run: async (client, args) => await client.get(buildPath(client, args)),
};

export const getCaptureLogs: ToolDef = {
  name: "get_capture_logs",
  title: "Get capture logs",
  description:
    "Get the capture attempts of a build and the log lines of one attempt (latest by default). Use it to debug failed or flaky captures.",
  readOnly: true,
  input: {
    project,
    buildId,
    attemptNo: z.number().int().min(1).optional().describe("Attempt number (default: latest)"),
    tail: z.number().int().min(1).max(500).default(100).describe("Last N log lines"),
  },
  run: async (client, args) => {
    const base = buildPath(client, args);
    const attempts = await client.get<{ attemptNo: number }[]>(`${base}/attempts`);
    const latest = attempts.at(-1)?.attemptNo;
    const attemptNo = (args["attemptNo"] as number | undefined) ?? latest;
    if (attemptNo === undefined) return { attempts, logs: [] };
    const logs = await client.get<Record<string, unknown>[]>(`${base}/attempts/${attemptNo}/logs`);
    const tail = Number(args["tail"] ?? 100);
    return {
      attempts,
      attemptNo,
      logs: logs.slice(-tail).map((l) => pickFields(l, ["seq", "level", "message", "fields"])),
    };
  },
};

function pickFields(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

export const buildTools: ToolDef[] = [listBuilds, getBuild, getCaptureLogs];
