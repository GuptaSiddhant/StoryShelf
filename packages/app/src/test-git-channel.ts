import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { NotificationChannelModel, ProjectModel } from "@storyshelf/core/models";
import type { NotificationChannelRow } from "@storyshelf/core/schema";

/**
 * Seed a per-project git channel straight into the database, as one made before release N+1 of
 * ADR 0054 would be: the API and the form refuse new ones, and existing ones keep delivering.
 */
export async function seedGitChannel(
  db: DatabaseAdapter,
  input: {
    project: string;
    provider: string;
    config: Record<string, unknown>;
    secret?: string;
    /** The server secret the app is configured with. */
    serverSecret?: string;
  },
): Promise<NotificationChannelRow> {
  const projects = new ProjectModel(db);
  const project = (await projects.getBySlug(input.project)) ?? (await projects.get(input.project));
  if (project === null) {
    throw new Error(`no project ${input.project}`);
  }
  const channels = new NotificationChannelModel(db, undefined, input.serverSecret ?? "test-secret");
  return await channels.create({
    projectId: project.id,
    provider: input.provider,
    config: input.config,
    secret: input.secret,
  });
}
