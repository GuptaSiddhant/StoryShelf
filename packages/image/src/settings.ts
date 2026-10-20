/** Process-wide image settings, set once at app boot and read by the diff pool and thumbnails. */
import {
  DEFAULT_IMAGE_ENGINE,
  IMAGE_ENGINE_ENV,
  type ImageEngine,
  resolveImageEngine,
} from "./codec.ts";
import { loadCodec } from "./codecs.ts";

/** What `createShelfApp` passes down: `images.engine` and `compare.threads`. */
export interface ImageSettings {
  /** Image library: `"pngjs"` (default) or `"sharp"`; falls back to `STORYSHELF_IMAGE_ENGINE`. */
  engine?: string;
  /** Worker threads for diffs; `0` runs on the main thread. */
  threads?: number;
}

let configuredEngine: ImageEngine | undefined;
let configuredThreads: number | undefined;

/**
 * Record the engine and thread count (the caller then rebuilds anything that depends on them).
 * The option wins: `STORYSHELF_IMAGE_ENGINE` is read only when no engine is given, so a bad
 * variable cannot break an explicit option. Throws on an unknown name so a typo never silently
 * picks a different engine.
 */
export function setImageSettings(settings: ImageSettings): void {
  configuredEngine = resolveImageEngine(settings.engine ?? process.env[IMAGE_ENGINE_ENV]);
  configuredThreads = settings.threads;
}

/** What the last {@link setImageSettings} resolved, without consulting the environment. */
export function appliedImageSettings(): {
  engine: ImageEngine | undefined;
  threads: number | undefined;
} {
  return { engine: configuredEngine, threads: configuredThreads };
}

/** The engine in effect: the configured one, else the environment, else the default. */
export function currentImageEngine(): ImageEngine {
  return configuredEngine ?? resolveImageEngine(process.env[IMAGE_ENGINE_ENV]);
}

/** The configured thread count, or `undefined` to defer to the environment/default. */
export function configuredThreadCount(): number | undefined {
  return configuredThreads;
}

/**
 * Load the engine's dependencies now, so a missing `sharp` fails at boot with a clear message
 * instead of on the first diff. The default engine is a hard dependency with nothing to verify,
 * so it returns at once and never delays startup (or the first poll of a capture worker).
 */
export async function verifyImageEngine(): Promise<ImageEngine> {
  const engine = currentImageEngine();
  if (engine !== DEFAULT_IMAGE_ENGINE) {
    await loadCodec(engine);
  }
  return engine;
}
