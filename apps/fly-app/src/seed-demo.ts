/**
 * Demo seed: one "Demo Design System" project captured by the real pipeline.
 *
 * Two builds go through `/api/v1` like any CI upload: `main` (auto-approved, so it becomes the
 * baseline) and `feature/new-button`, a copy of the fixture with restyled primary buttons, so the
 * review page shows real pixel diffs next to unchanged stories. Seeding is idempotent: build SHAs
 * derive from the fixture's `index.json`, so a reboot with the same fixture does nothing, and a
 * changed fixture wipes and re-seeds only this project.
 */
import type { ShelfApp } from "@storyshelf/app";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import type { Logger } from "@storyshelf/core/logger";
import { BuildModel, LabelModel, ProjectModel, TokenModel } from "@storyshelf/core/models";
import type { Project, User } from "@storyshelf/core/schema";
import { sha256, slugify } from "@storyshelf/core/utils";
import { existsSync } from "node:fs";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createSeedClient, type SeedBuildMeta } from "./seed-client.ts";

/** How the seed authenticates its own API calls. */
export type SeedAuth =
  | { kind: "none" }
  | { kind: "admin-token"; token: string }
  | { kind: "user"; email: string };

/** Inputs for {@link seedDemo}. */
export interface SeedDemoOptions {
  app: ShelfApp;
  database: DatabaseAdapter;
  storage: StorageAdapter;
  logger: Logger;
  /** Where the restyled fixture copy is written. */
  scratchDir: string;
  auth: SeedAuth;
}

const DEMO = { name: "Demo Design System", repo: "acme/design-system", branch: "main" };
const FEATURE_BRANCH = "feature/new-button";
const AUTHOR = { authorName: "Alex Doe", authorEmail: "alex@example.com" };
/** Restyles primary buttons only (their inline background), leaving secondary stories unchanged. */
const FEATURE_CSS =
  'button[style*="43, 127, 255"]{background:#7c3aed!important;border-radius:999px!important}';

/** Seed (or refresh) the demo project; other projects are never touched. */
export async function seedDemo(options: SeedDemoOptions): Promise<void> {
  const log = options.logger.child({ seed: "demo" });
  const storybookDir = resolveStorybookDir();
  if (!storybookDir) {
    log.warn("storybook-static not found; skipping the demo seed");
    return;
  }
  await seedFrom(options, storybookDir, log);
}

/** Capture the fixture unless this exact fixture is already seeded. */
async function seedFrom(
  options: SeedDemoOptions,
  storybookDir: string,
  log: Logger,
): Promise<void> {
  const builds = await demoBuilds(storybookDir);
  const existing = await new ProjectModel(options.database).getBySlug(slugify(DEMO.name));
  if (existing && (await isSeeded(options.database, existing.id, builds))) {
    log.info({ projectId: existing.id }, "demo seed up to date");
    return;
  }
  const project = await recreateDemoProject(options, existing);
  await pushBuilds(options, project, builds, storybookDir);
  log.info({ projectId: project.id }, "demo seeded through the capture pipeline");
}

/** The two seed builds, with SHAs tied to the fixture so a changed fixture re-seeds. */
async function demoBuilds(
  storybookDir: string,
): Promise<{ main: SeedBuildMeta; feature: SeedBuildMeta }> {
  const fingerprint = sha256(await readFile(join(storybookDir, "index.json"), "utf8"));
  const shaFor = (branch: string): string => sha256(`${branch}:${fingerprint}`).slice(0, 40);
  return {
    main: {
      ...AUTHOR,
      gitSha: shaFor(DEMO.branch),
      gitBranch: DEMO.branch,
      message: "chore: design system baseline",
    },
    feature: {
      ...AUTHOR,
      gitSha: shaFor(FEATURE_BRANCH),
      gitBranch: FEATURE_BRANCH,
      message: "feat: rounded primary button in the new brand colour",
    },
  };
}

async function isSeeded(
  database: DatabaseAdapter,
  projectId: string,
  builds: { main: SeedBuildMeta; feature: SeedBuildMeta },
): Promise<boolean> {
  const stored = await new BuildModel(database).list(projectId);
  const ok = (sha: string): boolean =>
    stored.some((build) => build.gitSha === sha && build.status !== "failed");
  return ok(builds.main.gitSha) && ok(builds.feature.gitSha);
}

/** Delete the project's files, then the project (its rows cascade). */
async function wipeProject(options: SeedDemoOptions, project: Project): Promise<void> {
  const keys = await options.storage.list(`${project.id}/`);
  await Promise.all(
    keys.map(async (key) => {
      await options.storage.delete(key);
    }),
  );
  await new ProjectModel(options.database).remove(project.id);
}

/** Start from a clean project: the stale one (if any) is wiped first. */
async function recreateDemoProject(
  options: SeedDemoOptions,
  existing: Project | null,
): Promise<Project> {
  if (existing) {
    await wipeProject(options, existing);
  }
  const project = await new ProjectModel(options.database).create({
    name: DEMO.name,
    gitRepository: DEMO.repo,
    gitDefaultBranch: DEMO.branch,
  });
  await new LabelModel(options.database).seedFor(project.id);
  return project;
}

/** Upload `main` first and wait for it, so the feature build diffs against its baselines. */
async function pushBuilds(
  options: SeedDemoOptions,
  project: Project,
  builds: { main: SeedBuildMeta; feature: SeedBuildMeta },
  storybookDir: string,
): Promise<void> {
  const credential = await seedCredential(options, project.id);
  try {
    const client = createSeedClient(options.app, project.slug, credential.token);
    await client.pushBuild(builds.main, storybookDir);
    const variantDir = await writeFeatureVariant(
      storybookDir,
      join(options.scratchDir, "seed-demo"),
    );
    await client.pushBuild(builds.feature, variantDir);
  } finally {
    await credential.revoke();
  }
}

/** A bearer token for the seed, revoked afterwards when it was minted here. */
async function seedCredential(
  options: SeedDemoOptions,
  projectId: string,
): Promise<{ token?: string; revoke: () => Promise<void> }> {
  const { auth, database } = options;
  if (auth.kind === "none") {
    return { revoke: async () => {} };
  }
  if (auth.kind === "admin-token") {
    return { token: auth.token, revoke: async () => {} };
  }
  // Tokens act as their owner; an ownerless token is only a viewer and cannot upload.
  const owner = await findUserByEmail(database, auth.email);
  const tokens = new TokenModel(database);
  const { token, value } = await tokens.issue(projectId, { name: "demo-seed", userId: owner.id });
  return {
    token: value,
    revoke: async () => {
      await tokens.remove(token.id);
    },
  };
}

async function findUserByEmail(database: DatabaseAdapter, email: string): Promise<User> {
  const users = (await database.list(database.tables.users)) as unknown as User[];
  const user = users.find((candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase());
  if (!user) {
    throw new Error(`demo seed: no user ${email} to own its upload token`);
  }
  return user;
}

/** Copy the fixture and inject the feature-branch styles into the story iframe. */
async function writeFeatureVariant(storybookDir: string, outDir: string): Promise<string> {
  await rm(outDir, { recursive: true, force: true });
  await cp(storybookDir, outDir, { recursive: true });
  const iframe = join(outDir, "iframe.html");
  const html = await readFile(iframe, "utf8");
  await writeFile(iframe, html.replace("</head>", `<style>${FEATURE_CSS}</style></head>`));
  return outDir;
}

function resolveStorybookDir(): string | null {
  const candidates = [
    resolve("fixtures/storybook-8/storybook-static"),
    join(import.meta.dirname, "../../fixtures/storybook-8/storybook-static"),
    "/app/fixtures/storybook-8/storybook-static",
  ];
  return candidates.find((dir) => existsSync(join(dir, "index.json"))) ?? null;
}
