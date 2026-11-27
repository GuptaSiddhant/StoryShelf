import { HTTPException } from "hono/http-exception";
import { getStore } from "../store.ts";

/** Error codes that mean the storage volume has no room left (disk full, quota reached). */
const OUT_OF_SPACE_CODES: ReadonlySet<string> = new Set(["ENOSPC", "EDQUOT"]);

/** Whether `error`, or its cause, is a "no space left" failure from the storage backend. */
export function isOutOfSpace(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && OUT_OF_SPACE_CODES.has(code)) return true;
  return error.cause !== undefined && isOutOfSpace(error.cause);
}

/**
 * Run an upload step that writes to storage. A full volume answers 507 with a message that says
 * so, and logs the cause; any other error is rethrown untouched for the app's error handler.
 */
export async function withUploadStorage<T>(
  step: string,
  buildId: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isOutOfSpace(error)) throw error;
    getStore().logger.error(
      { err: error, buildId, step },
      "upload failed: the storage volume is out of space",
    );
    throw new HTTPException(507, {
      message:
        "The server's storage is full; the upload was not stored. Ask the operator to free space.",
    });
  }
}
