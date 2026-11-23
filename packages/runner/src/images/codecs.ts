/** Codec registry: engines load on demand so an unused engine's dependencies are never imported. */
import type { ImageCodec, ImageEngineName } from "./codec.ts";
import { importPeer } from "./peers.ts";

const loaded = new Map<ImageEngineName, Promise<ImageCodec>>();

/** The codec for an engine, loaded once per thread. Rejects when its dependency is unavailable. */
export async function loadCodec(engine: ImageEngineName): Promise<ImageCodec> {
  const existing = loaded.get(engine);
  if (existing) {
    return await existing;
  }
  const pending = engine === "sharp" ? importSharpCodec() : importPngjsCodec();
  loaded.set(engine, pending);
  try {
    return await pending;
  } catch (error) {
    loaded.delete(engine);
    throw error;
  }
}

async function importPngjsCodec(): Promise<ImageCodec> {
  return await importPeer("pngjs", async () => (await import("./pngjs.ts")).pngjsCodec);
}

async function importSharpCodec(): Promise<ImageCodec> {
  return await (await import("./sharp.ts")).createSharpCodec();
}
