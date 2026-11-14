import { createRoute, z } from "@hono/zod-openapi";
import type { Context, Next } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { MAX_OFFLINE_PROJECTS, offlineProjectsOf } from "./offline.handlers.ts";
import { hostingMode } from "./published-access.ts";

/** Hono pattern of the route, shared with the middleware that keeps every answer out of caches. */
export const OFFLINE_PATH = "/api/v1/offline";

const offlineSchema = z
  .object({
    projects: z.array(
      z.object({
        slug: z.string(),
        name: z.string(),
        buildId: z.string(),
        commit: z.string(),
        entries: z.array(
          z.object({
            path: z.string(),
            hash: z.string().describe("Content hash of the file"),
            size: z.number().int().min(0).describe("Bytes"),
          }),
        ),
        maxOfflineDays: z.number().int(),
      }),
    ),
    reason: z
      .literal("hosting-mode")
      .optional()
      .describe("Present when offline Storybooks are off for this deployment's hosting mode"),
    hostingMode: z.string().optional().describe("The hosting mode, present with `reason`"),
  })
  .openapi("OfflineSync");

const offlineRoute = createRoute({
  method: "get",
  tags: ["Builds"],
  summary: "Offline sync of default-branch Storybooks",
  description: `For each requested project the caller may read, the latest published build on its default branch with its file manifest (ADR 0048). A project that is unknown, hidden or has no such build is left out. Only \`trusted\` hosting mode supports offline Storybooks (ADR 0048, amendment 2026-11-11); in any other mode the list is empty with \`reason: "hosting-mode"\`, so the next sync deletes what a device kept. Answers \`Cache-Control: private, no-store\`. At most ${MAX_OFFLINE_PROJECTS} slugs.`,
  path: "/api/v1/offline",
  request: {
    query: z.object({
      projects: z.string().describe("Comma-separated project slugs"),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: offlineSchema } },
      description: "The projects that can be kept offline",
    },
  },
});

/** `Cache-Control: private, no-store`: the answer depends on who asks. */
export async function offlineNoStore(c: Context, next: Next): Promise<void> {
  await next();
  c.res.headers.set("Cache-Control", "private, no-store");
}

/** Register the offline sync endpoint (`hosting` class). */
export function registerOffline(app: ShelfRouter): void {
  app.use(OFFLINE_PATH, offlineNoStore);
  app.openapi(offlineRoute, async (c) => {
    const mode = hostingMode();
    if (mode !== "trusted") {
      return c.json({ projects: [], reason: "hosting-mode" as const, hostingMode: mode }, 200);
    }
    const slugs = c.req
      .valid("query")
      .projects.split(",")
      .map((slug) => slug.trim())
      .filter((slug) => slug !== "");
    return c.json({ projects: await offlineProjectsOf(slugs) }, 200);
  });
}
