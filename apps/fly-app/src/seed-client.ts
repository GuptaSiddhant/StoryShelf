/**
 * Pushes a built Storybook through the app's own `/api/v1`, exactly as the CLI does in CI:
 * create the build, upload the zip, then wait for the capture pipeline to finish it.
 */
import type { ShelfApp } from "@storyshelf/app";
import type { Build } from "@storyshelf/core/schema";
import type { BuildStatus } from "@storyshelf/core/types";
import { zipStream, type ZipSource } from "@storyshelf/core/utils";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/** Build metadata, as `storyshelf upload` sends it. */
export interface SeedBuildMeta {
  gitSha: string;
  gitBranch: string;
  message: string;
  authorName: string;
  authorEmail: string;
}

/** Creates and uploads builds for one project. */
export interface SeedClient {
  /** Create a build from `storybookDir` and resolve once capture has settled it. */
  pushBuild(meta: SeedBuildMeta, storybookDir: string): Promise<Build>;
}

/** Statuses a build only leaves by human review (or never). */
const SETTLED: ReadonlySet<BuildStatus> = new Set(["reviewing", "approved", "rejected", "failed"]);
const POLL_MS = 2000;
const TIMEOUT_MS = 15 * 60 * 1000;

/**
 * @param app - The running app; requests go through `app.request`, no network hop.
 * @param slug - Project slug.
 * @param token - Bearer token (project or admin); omit when auth is disabled.
 */
export function createSeedClient(app: ShelfApp, slug: string, token?: string): SeedClient {
  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
    const res = await app.request(path, { ...init, headers });
    if (!res.ok) {
      throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
    }
    return res;
  };
  return {
    async pushBuild(meta, storybookDir) {
      const created = await call(`/api/v1/projects/${slug}/builds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(meta),
      });
      const { build, uploadUrl } = (await created.json()) as { build: Build; uploadUrl: string };
      const zip = await zipDirectory(storybookDir);
      await call(uploadUrl, {
        method: "PUT",
        headers: { "content-type": "application/zip", "content-length": String(zip.length) },
        body: new Uint8Array(zip),
      });
      return await waitForSettled(call, `/api/v1/projects/${slug}/builds/${build.id}`);
    },
  };
}

async function waitForSettled(
  call: (path: string) => Promise<Response>,
  path: string,
): Promise<Build> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- polling: each check waits on the previous one
    const build = (await (await call(path)).json()) as Build;
    if (SETTLED.has(build.status)) {
      return build;
    }
    // oxlint-disable-next-line no-await-in-loop -- polling interval
    await sleep(POLL_MS);
  }
  throw new Error(`${path} did not settle within ${TIMEOUT_MS / 60_000} minutes`);
}

/** Zip a directory in memory with `/`-separated entry names (a built Storybook is a few MB). */
async function zipDirectory(dir: string): Promise<Buffer> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const sources: ZipSource[] = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const full = join(entry.parentPath, entry.name);
      return {
        name: relative(dir, full).split(sep).join("/"),
        data: async () => await readFile(full),
      };
    });
  const chunks: Buffer[] = [];
  for await (const chunk of zipStream(sources)) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
