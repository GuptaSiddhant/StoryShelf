/** Worker-thread entry for the diff pool: runs the same `diffImages` as the in-thread path. */
import { parentPort } from "node:worker_threads";
import { diffImages } from "./engine.ts";
import type { DiffRequest, DiffResponse } from "./protocol.ts";
import { fromTransferred, toTransferable } from "./transfer.ts";

const port = parentPort;

function handle(request: DiffRequest): void {
  if (!port) {
    return;
  }
  try {
    const result = diffImages(
      fromTransferred(request.baseline),
      fromTransferred(request.current),
      request.options,
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

port?.on("message", handle);
port?.postMessage({ type: "ready" } satisfies DiffResponse);
