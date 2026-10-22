/**
 * File-by-file upload (`/dedup`, `/content`, `/manifest`): stores a build's files content-addressed
 * and needs no zip extraction on the server, so it publishes on any host, serverless included.
 * `upload` falls back to it when the server refuses a zip over its inline limit.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { RequestError, type createClient } from "../client.ts";
import { hashFiles, walkFiles, type HashedFile } from "./dedup.ts";

/** Files sent in one `/content` request. */
const BATCH_FILES = 50;
/** Bytes sent in one `/content` request (a single larger file goes alone). */
const BATCH_BYTES = 16 * 1024 * 1024;
/** Hashes asked about in one `/dedup` request. */
const DEDUP_CHUNK = 5000;

/** What the server answers a zip it cannot extract inline and cannot hand to a job. */
export function isOverInlineLimit(error: unknown): boolean {
  return error instanceof RequestError && error.status === 413 && error.message.includes("/dedup");
}

/** Where a build's files are and which build they belong to. */
export interface FileUploadTarget {
  slug: string;
  buildId: string;
  cwd: string;
  buildDir: string;
}

/** Upload every file of the build directory the server lacks, then post the manifest. */
export async function uploadFileByFile(
  client: ReturnType<typeof createClient>,
  target: FileUploadTarget,
  log: (line: string) => void,
): Promise<void> {
  const files = await hashFiles(
    target.cwd,
    target.buildDir,
    await walkFiles(target.cwd, target.buildDir),
  );
  const needed = await neededHashes(client, target, files);
  const toSend = firstFileOfEach(files, needed);
  log(`Uploading ${toSend.length} of ${files.length} files (the server has the rest)`);
  for (const batch of batches(toSend)) {
    // oxlint-disable-next-line no-await-in-loop -- batches go one after another to bound memory
    await sendBatch(client, target, batch);
  }
  await client.projects.builds.postManifest(target.slug, target.buildId, files);
}

async function neededHashes(
  client: ReturnType<typeof createClient>,
  target: FileUploadTarget,
  files: HashedFile[],
): Promise<Set<string>> {
  const unique = [...new Set(files.map((file) => file.hash))];
  const needed = new Set<string>();
  for (let at = 0; at < unique.length; at += DEDUP_CHUNK) {
    // oxlint-disable-next-line no-await-in-loop -- sequential chunks keep the request size bounded
    const answer = await client.projects.builds.dedup(
      target.slug,
      target.buildId,
      unique.slice(at, at + DEDUP_CHUNK),
    );
    for (const hash of answer) {
      needed.add(hash);
    }
  }
  return needed;
}

/** One file per needed hash (identical files are sent once). */
function firstFileOfEach(files: HashedFile[], needed: Set<string>): HashedFile[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (!needed.has(file.hash) || seen.has(file.hash)) {
      return false;
    }
    seen.add(file.hash);
    return true;
  });
}

/** Split into requests of at most {@link BATCH_FILES} files and {@link BATCH_BYTES} bytes (one big file goes alone). */
function batches(files: HashedFile[]): HashedFile[][] {
  const out: HashedFile[][] = [];
  for (const file of files) {
    const last = out.at(-1);
    if (last && fitsBatch(last, file)) {
      last.push(file);
    } else {
      out.push([file]);
    }
  }
  return out;
}

function fitsBatch(batch: HashedFile[], file: HashedFile): boolean {
  const bytes = batch.reduce((sum, member) => sum + member.size, 0);
  return batch.length < BATCH_FILES && bytes + file.size <= BATCH_BYTES;
}

async function sendBatch(
  client: ReturnType<typeof createClient>,
  target: FileUploadTarget,
  batch: HashedFile[],
): Promise<void> {
  const root = resolve(target.cwd, target.buildDir);
  const files = await Promise.all(
    batch.map(async (file) => ({ hash: file.hash, data: await readFile(join(root, file.rel)) })),
  );
  await client.projects.builds.uploadContent(target.slug, target.buildId, files);
}
