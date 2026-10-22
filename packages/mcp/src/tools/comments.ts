import { z } from "zod";
import { buildPath, type ToolDef } from "./types.ts";

const project = z.string().optional().describe("Project slug (defaults to STORYSHELF_SLUG)");
const buildId = z.string().describe("Build id (ULID)");

export const listComments: ToolDef = {
  name: "list_comments",
  title: "List comments",
  description:
    "List review comments on a build: build comments, story comments and per-snapshot threads. A project with review off has none (the call fails with 404).",
  readOnly: true,
  input: { project, buildId },
  run: async (client, args) => await client.get(`${buildPath(client, args)}/comments`),
};

export const addComment: ToolDef = {
  name: "add_comment",
  title: "Add comment",
  description:
    "Add a review comment to a build, optionally on one story or one snapshot (not both) or as a reply. Needs a token with developer role or above. Visible to everyone on the project. There is no tool to approve or reject a build: a verdict is for people. Fails with 404 when the project has review off.",
  readOnly: false,
  input: {
    project,
    buildId,
    body: z.string().min(1).max(4000),
    storyId: z.string().optional().describe("Attach to this story id (not with snapshotId)"),
    snapshotId: z.string().optional().describe("Attach to this snapshot (not with storyId)"),
    parentId: z.string().optional().describe("Reply to this comment id"),
  },
  run: async (client, args) =>
    await client.post(`${buildPath(client, args)}/comments`, {
      body: args["body"],
      ...(args["storyId"] ? { storyId: args["storyId"] } : {}),
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
