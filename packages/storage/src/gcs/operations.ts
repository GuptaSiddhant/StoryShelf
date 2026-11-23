/** Buffered CRUD (read/write/delete/exists) plus paginated listing for GCS. */
import type { GcsContext } from "./client.ts";
import { isNotFound } from "./errors.ts";
import { gcsKey, gcsRel } from "./keys.ts";

/** Download the full bytes stored at `path`. */
export async function gcsRead(ctx: GcsContext, path: string): Promise<Buffer> {
  const file = ctx.bucket.file(gcsKey(ctx.prefix, path));
  const [data] = await file.download();
  return data;
}

/** Save `data` at `path`, overwriting any existing object. */
export async function gcsWrite(ctx: GcsContext, path: string, data: Buffer): Promise<void> {
  await ctx.bucket.file(gcsKey(ctx.prefix, path)).save(data);
}

/** Delete the object at `path`, ignoring not-found errors. */
export async function gcsDelete(ctx: GcsContext, path: string): Promise<void> {
  try {
    await ctx.bucket.file(gcsKey(ctx.prefix, path)).delete();
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}

/** Return whether an object exists at `path`. */
export async function gcsExists(ctx: GcsContext, path: string): Promise<boolean> {
  const [exists] = await ctx.bucket.file(gcsKey(ctx.prefix, path)).exists();
  return exists;
}

/** List paths under `listPrefix`, following pagination to exhaustion. */
export async function gcsList(ctx: GcsContext, listPrefix: string): Promise<string[]> {
  const prefix = gcsKey(ctx.prefix, listPrefix);
  const results: string[] = [];
  let query: Record<string, unknown> | undefined =
    prefix === "" ? { autoPaginate: false } : { prefix, autoPaginate: false };
  while (query !== undefined) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- pagination requires sequential awaits
    const [files, nextQuery] = (await ctx.bucket.getFiles(query as never)) as unknown as [
      { name: string }[],
      Record<string, unknown> | null,
    ];
    for (const file of files) {
      results.push(gcsRel(ctx.prefix, file.name));
    }
    query = nextQueryQuery(nextQuery);
  }
  return results;
}

function nextQueryQuery(
  nextQuery: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  if (!nextQuery || typeof nextQuery !== "object") {
    return undefined;
  }
  const token = (nextQuery as { pageToken?: string }).pageToken;
  return token ? nextQuery : undefined;
}
