/** Message shapes exchanged between the diff pool and `worker.ts`. */
import type { ImageEngine } from "./codec.ts";
import type { DiffOptions, DiffResult } from "./options.ts";

/** Pool to worker: diff two PNGs. Both arrays are transferred, not copied. */
export interface DiffRequest {
  id: number;
  baseline: Uint8Array;
  current: Uint8Array;
  options: DiffOptions;
  /** Which codec the worker decodes and encodes with. */
  engine: ImageEngine;
}

/** A {@link DiffResult} whose overlay travels as a transferable Uint8Array. */
export type WireResult = Omit<DiffResult, "diffImage"> & { diffImage: Uint8Array | null };

/** Worker to pool. `ready` proves the worker file loaded; the others answer a request. */
export type DiffResponse =
  | { type: "ready" }
  | { type: "result"; id: number; result: WireResult }
  | { type: "error"; id: number; name: string; message: string };
