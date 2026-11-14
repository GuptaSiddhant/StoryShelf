/** PNG thumbnails on the configured engine (output stays PNG). */
import { loadCodec } from "./codecs.ts";
import { currentImageEngine } from "./settings.ts";

/** Downscale a PNG so its long edge is at most `maxEdge`, using the configured image engine. */
export async function downscalePng(buffer: Uint8Array, maxEdge: number): Promise<Uint8Array> {
  const codec = await loadCodec(currentImageEngine());
  return await codec.downscale(buffer, maxEdge);
}
