import type { ZodRawShape } from "zod";
import type { ApiClient } from "../client.ts";
import { ToolError } from "../client.ts";

/** One MCP tool: schema + handler. Handlers return plain JSON-serialisable data. */
export interface ToolDef<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  title: string;
  description: string;
  /** False for tools that write (comments only in v1). */
  readOnly: boolean;
  input: Shape;
  run(client: ApiClient, args: Record<string, unknown>): Promise<unknown>;
}

/** Resolve the project slug from the call argument or the configured default. */
export function projectSlug(client: ApiClient, project: unknown): string {
  const slug = typeof project === "string" && project ? project : client.defaultSlug;
  if (!slug) {
    throw new ToolError("No project given: pass `project` or set STORYSHELF_SLUG");
  }
  return encodeURIComponent(slug);
}

/** Build the `/projects/{slug}/builds/{id}` path prefix. */
export function buildPath(client: ApiClient, args: Record<string, unknown>): string {
  return `/projects/${projectSlug(client, args["project"])}/builds/${encodeURIComponent(String(args["buildId"]))}`;
}
