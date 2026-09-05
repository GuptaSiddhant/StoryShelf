import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Logger } from "pino";
import { Parse, type Entry } from "unzipper";
import type { CaptureRunner } from "../adapters/capture-runner.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { BuildModel } from "../models/build.ts";
import { ProjectModel } from "../models/project.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import { storybookDir, storybookZipPath } from "../utils/paths.ts";
import { DEFAULT_VIEWPORTS, isDisabledStory, isFlakyStory } from "./adapter.ts";
import type { Viewport } from "./adapter.ts";
import { persistCapture } from "./pipeline.ts";
import { StorybookAdapter } from "./storybook.ts";

/** Inputs for running a capture job against a Storybook build. */
export interface CaptureJobOptions {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  runner: CaptureRunner;
  scratchDir: string;
  viewports?: Viewport[];
  logger?: Logger;
  /** Server secret for decrypting webhook secrets at send time. */
  secret?: string | undefined;
}
/**
 * Run the full capture for a build: extract, render, persist, and finalize.
 *
 * @param input - Build id plus the originating request id.
 * @param options - Adapters, scratch dir, viewports, and logger.
 */
export async function executeCaptureJob(
  input: { buildId: string; reqId?: string },
  options: CaptureJobOptions,
): Promise<void> {
  const builds = new BuildModel(options.db);
  const { build, project } = await loadTarget(options, input.buildId);
  const logger = options.logger?.child({ buildId: input.buildId, reqId: input.reqId });
  await builds.setStatus(build.id, "capturing");

  const startTime = performance.now();
  let extractedDir: string | undefined;
  try {
    const extractStart = performance.now();
    extractedDir = await extractStorybook(options, project.id, build.id);
    const extractDuration = performance.now() - extractStart;
    logger?.info({ durationMs: Math.round(extractDuration) }, "storybook extracted");

    // Persist the extracted statics to storage so the published Storybook
    // (`storybookDir`) can be served after the scratch dir is cleaned up.
    const staticsStart = performance.now();
    await persistStorybookStatics(options.storage, extractedDir, project.id, build.id);
    logger?.info(
      { durationMs: Math.round(performance.now() - staticsStart) },
      "storybook statics persisted",
    );

    const adapter = new StorybookAdapter();
    const discovered = await adapter.discover(extractedDir);
    const stories = discovered.filter((s) => !isDisabledStory(s));
    const viewports = options.viewports ?? DEFAULT_VIEWPORTS;

    const renderStart = performance.now();
    const result = await options.runner.render({
      buildId: build.id,
      storybookDir: extractedDir,
      stories,
      viewports,
      logger,
      executePlay: project.executePlay ?? false,
      playTimeoutMs: project.playTimeoutMs ?? 10_000,
    });
    const renderDuration = performance.now() - renderStart;
    logger?.info(
      { durationMs: Math.round(renderDuration), storyCount: stories.length },
      "stories rendered",
    );

    const flakyStoryIds = new Set(stories.filter((s) => isFlakyStory(s)).map((s) => s.id));
    const blockingFailed = new Set<string>();
    const flakyFailed = new Set<string>();
    for (const f of result.failures) {
      if (flakyStoryIds.has(f.storyId)) flakyFailed.add(f.storyId);
      else blockingFailed.add(f.storyId);
    }

    const persistStart = performance.now();
    await persistCapture(
      {
        db: options.db,
        storage: options.storage,
        project,
        build,
        viewports,
        captures: result.captures,
        logger,
        secret: options.secret,
      },
      blockingFailed,
      flakyFailed,
    );
    const persistDuration = performance.now() - persistStart;
    logger?.info({ durationMs: Math.round(persistDuration) }, "capture persisted");

    const totalDuration = performance.now() - startTime;
    logger?.info({ durationMs: Math.round(totalDuration) }, "capture completed");
  } catch (error) {
    const totalDuration = performance.now() - startTime;
    logger?.error({ durationMs: Math.round(totalDuration), err: error }, "capture failed");
    await builds.setStatus(build.id, "failed").catch((markError: unknown) => {
      logger?.error({ err: markError }, "failed to mark build failed after capture error");
    });
    throw error;
  }
}

async function loadTarget(
  options: CaptureJobOptions,
  buildId: string,
): Promise<{ build: Build; project: Project }> {
  const build = await new BuildModel(options.db).get(buildId);
  if (!build) {
    throw new Error(`Build not found: ${buildId}`);
  }
  const project = await new ProjectModel(options.db).get(build.projectId);
  if (!project) {
    throw new Error(`Project not found: ${build.projectId}`);
  }
  return { build, project };
}

function blockedTarget(root: string, entryName: string): boolean {
  const candidate = resolve(join(root, entryName));
  return candidate !== root && !candidate.startsWith(root + sep);
}

/** Pipe one zip entry to disk, tracking the write for later aggregation. */
function handleEntry(
  root: string,
  entry: Entry,
  writes: Promise<void>[],
  fail: (error: unknown) => void,
): void {
  if (blockedTarget(root, entry.path)) {
    entry.autodrain();
    fail(new Error(`Blocked path traversal in uploaded Storybook: ${entry.path}`));
    return;
  }
  if (entry.type === "Directory") {
    entry.autodrain();
    return;
  }
  const target = join(root, entry.path);
  const done = (async (): Promise<void> => {
    await mkdir(dirname(target), { recursive: true });
    await pipeline(entry, createWriteStream(target));
  })();
  writes.push(done);
  done.catch(() => {}); // Intentionally empty — aggregated via allSettled by the caller
}

/** Run the unzipper parser, resolving with the first parse error (or null). */
// oxlint-disable-next-line typescript/promise-function-async -- executor-style promise wrapper around events
function runParser(
  root: string,
  source: import("node:stream").Readable,
  writes: Promise<void>[],
): Promise<unknown> {
  return new Promise((settle) => {
    const parser = Parse();
    const fail = (error: unknown): void => {
      source.destroy();
      settle(error);
    };
    parser.on("entry", (entry: Entry) => {
      handleEntry(root, entry, writes, fail);
    });
    parser.on("error", fail);
    parser.on("close", () => {
      settle(null);
    });
    source.on("error", fail);
    source.pipe(parser);
  });
}

async function extractStorybook(
  options: CaptureJobOptions,
  projectId: string,
  buildId: string,
): Promise<string> {
  const targetDir = join(options.scratchDir, projectId, "builds", buildId, "storybook");
  const root = resolve(targetDir);
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  const source = await options.storage.readStream(storybookZipPath(projectId, buildId));
  const writes: Promise<void>[] = [];
  const parseError = await runParser(root, source, writes);
  const outcomes = await Promise.allSettled(writes);
  if (parseError) {
    throw parseError;
  }
  const writeError = outcomes.find(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
  );
  if (writeError) {
    throw writeError.reason;
  }
  return targetDir;
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        return await walkFiles(full);
      }
      return [full];
    }),
  );
  return nested.flat();
}

async function persistStorybookStatics(
  storage: StorageAdapter,
  sourceDir: string,
  projectId: string,
  buildId: string,
): Promise<void> {
  const root = resolve(sourceDir);
  const destinationPrefix = storybookDir(projectId, buildId);
  const files = await walkFiles(root);
  await Promise.all(
    files.map(async (file) => {
      const rel = relative(root, file);
      await storage.write(`${destinationPrefix}/${rel}`, await readFile(file));
    }),
  );
}
