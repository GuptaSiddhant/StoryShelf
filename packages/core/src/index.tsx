import type { FC } from "hono/jsx";
import { Hono } from "hono";

import type { AuthUser } from "./adapters/auth.ts";
import { Queue } from "./capture/queue.ts";
import type { ShelfOptions } from "./config.ts";
import { BuildModel } from "./models/build.ts";
import { ProjectModel } from "./models/project.ts";
import { SnapshotModel } from "./models/snapshot.ts";
import { registerAdmin } from "./routers/admin.ts";
import { registerBuilds } from "./routers/builds.ts";
import { registerLabels } from "./routers/labels.ts";
import { registerMembers } from "./routers/members.ts";
import { registerProjects } from "./routers/projects.ts";
import { registerTokens } from "./routers/tokens.ts";
import { getStore, runWithStore } from "./store.ts";
import { DocumentLayout } from "./ui/document.tsx";

async function resolveUser(c: { req: { raw: Request; header: (name: string) => string | undefined } }, options: ShelfOptions): Promise<AuthUser | null> {
  if (!options.auth) {
    return null;
  }
  if (c.req.header("authorization")) {
    return null;
  }
  return options.auth.check(c.req.raw);
}

const ProjectsPage: FC = () => {
  return <DocumentLayout title="Projects">
    <h1>Projects</h1>
    <ul>{/* populated via htmx on client */}</ul>
    <p>
      <a href="/projects">Manage projects</a>
    </p>
  </DocumentLayout>;
};

export function createShelfRouter(options: ShelfOptions): Hono {
  const app = new Hono();
  const config = options.config ?? {};
  const ui = options.ui ?? {};
  const logger = options.logger ?? console;
  const authEnabled = options.auth !== undefined;

  const queue = options.capture ? new Queue(config.captureConcurrency ?? 2) : null;
  const enqueueCapture = queue && options.capture ? (buildId: string) => queue.run(() => options.capture!.run(buildId)) : undefined;

  app.use("*", async (c, next) => {
    const user = await resolveUser(c, options);
    return runWithStore(
      { db: options.database, storage: options.storage, config, ui, logger, user, authEnabled, enqueueCapture },
      () => next(),
    );
  });

  registerProjects(app);
  registerBuilds(app);
  registerLabels(app);
  registerMembers(app);
  registerTokens(app);
  registerAdmin(app);

  app.get("/", (c) => c.html(<ProjectsPage />));

  app.get("/projects", async (c) => {
    const projects = await new ProjectModel(getStore().db).list();
    return c.html(
      <DocumentLayout title="Projects">
        <h1>Projects</h1>
        <ul>
          {projects.map((p) => (
            <li key={p.id}>
              <a href={`/projects/${p.slug}/builds`}>{p.name}</a>
            </li>
          ))}
        </ul>
      </DocumentLayout>,
    );
  });

  app.get("/projects/:slug/builds", async (c) => {
    const slug = c.req.param("slug");
    const projects = await new ProjectModel(getStore().db).list();
    const project = projects.find((p) => p.slug === slug);
    if (!project) {
      return c.notFound();
    }
    const builds = await new BuildModel(getStore().db).list(project.id);
    return c.html(
      <DocumentLayout title={project.name}>
        <h1>{project.name}</h1>
        <ul>
          {builds.map((b) => (
            <li key={b.id}>
              <a href={`/projects/${project.slug}/builds/${b.id}`}>{b.gitBranch}</a> · {b.status} · {b.message ?? ""}
            </li>
          ))}
        </ul>
      </DocumentLayout>,
    );
  });

  app.get("/projects/:slug/builds/:buildId", async (c) => {
    const build = await new BuildModel(getStore().db).get(c.req.param("buildId"));
    if (!build) {
      return c.notFound();
    }
    const snapshots = await new SnapshotModel(getStore().db).listByBuild(build.id);
    return c.html(
      <DocumentLayout title={`Build ${build.gitBranch}`}>
        <h1>
          {build.gitBranch} — {build.status}
        </h1>
        <ul>
          {snapshots.map((s) => (
            <li key={s.id}>
              {s.storyTitle} / {s.storyName} · {s.viewportName} · {s.status}
            </li>
          ))}
        </ul>
      </DocumentLayout>,
    );
  });

  return app;
}

export type { ShelfOptions, ShelfConfig, UIConfig, BrandTheme } from "./config.ts";
export type { DatabaseAdapter, ListOptions } from "./adapters/database.ts";
export type { StorageAdapter } from "./adapters/storage.ts";
export type { CaptureRunner, JobStatus } from "./adapters/capture-runner.ts";
export type { AuthAdapter, AuthUser, AuthCallback } from "./adapters/auth.ts";
export type { StatusAdapter, CheckStatus } from "./adapters/status.ts";
export type { LoggerAdapter } from "./adapters/logger.ts";
export type { DiffOptions, DiffResult } from "./diff/options.ts";
export type { Viewport, StoryEntry, StorySourceAdapter } from "./capture/adapter.ts";
export { diffImages } from "./diff/engine.ts";
export { StorybookAdapter } from "./capture/storybook.ts";
export { runCapture, type CaptureContext, type RenderStory } from "./capture/pipeline.ts";
export { Queue } from "./capture/queue.ts";
export { Retention } from "./retention/purge.ts";
export { createUrlBuilder, type UrlBuilder } from "./urls.ts";
export { ulid, slugify } from "./utils/ulid.ts";
export { baselinePath, diffPath, screenshotPath, storybookDir, storybookZipPath } from "./utils/paths.ts";
export * from "./schema.ts";
export * from "./types.ts";
