/** Worker-thread entry for the diff pool: runs the same `diffImages` as the in-thread path. */
import { parentPort } from "node:worker_threads";
import { loadCodec } from "./codecs.ts";
import { diffImages } from "./engine.ts";
import type { DiffRequest, DiffResponse } from "./protocol.ts";
import { fromTransferred, toTransferable } from "./transfer.ts";

const port = parentPort;

async function handle(request: DiffRequest): Promise<void> {
  if (!port) {
    return;
  }
  try {
    const result = await diffImages(
      fromTransferred(request.baseline),
      fromTransferred(request.current),
      request.options,
      await loadCodec(request.engine),
    );
    const diffImage = result.diffImage ? toTransferable(result.diffImage) : null;
    const response: DiffResponse = {
      type: "result",
      id: request.id,
      result: { ...result, diffImage },
    };
    port.postMessage(response, diffImage ? [diffImage.buffer as ArrayBuffer] : []);
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    const response: DiffResponse = {
      type: "error",
      id: request.id,
      name: cause.name,
      message: cause.message,
    };
    port.postMessage(response);
  }
}

port?.on("message", (request: DiffRequest) => {
  handle(request).catch((error: unknown) => {
    // Not even the error reply could be posted. Throw outside the promise so the thread dies with
    // an 'error' event, which rejects the pool's task, instead of leaving it waiting forever.
    setImmediate(() => {
      throw error;
    });
  });
});
port?.postMessage({ type: "ready" } satisfies DiffResponse);
