import { z } from "zod";
import { buildPath, type ToolDef } from "./types.ts";

const project = z.string().optional().describe("Project slug (defaults to STORYSHELF_SLUG)");
const buildId = z.string().describe("Build id (ULID)");

export const listComments: ToolDef = {
  name: "list_comments",
  title: "List comments",
  description: "List review comments on a build (including per-snapshot threads).",
  readOnly: true,
  input: { project, buildId },
  run: async (client, args) => await client.get(`${buildPath(client, args)}/comments`),
};

export const addComment: ToolDef = {
  name: "add_comment",
  title: "Add comment",
  description:
    "Add a review comment to a build, optionally on one snapshot or as a reply. Needs a token with developer role or above. Visible to everyone on the project.",
  readOnly: false,
  input: {
    project,
    buildId,
    body: z.string().min(1).max(4000),
    snapshotId: z.string().optional().describe("Attach to this snapshot"),
    parentId: z.string().optional().describe("Reply to this comment id"),
  },
  run: async (client, args) =>
    await client.post(`${buildPath(client, args)}/comments`, {
      body: args["body"],
      ...(args["snapshotId"] ? { snapshotId: args["snapshotId"] } : {}),
      ...(args["parentId"] ? { parentId: args["parentId"] } : {}),
    }),
};

export const resolveComment: ToolDef = {
  name: "resolve_comment",
  title: "Resolve comment",
  description: "Mark a review comment as resolved. Needs developer role or above.",
  readOnly: false,
  input: { project, buildId, commentId: z.string() },
  run: async (client, args) =>
    await client.post(
      `${buildPath(client, args)}/comments/${encodeURIComponent(String(args["commentId"]))}/resolve`,
    ),
};

export const commentTools: ToolDef[] = [listComments, addComment, resolveComment];
