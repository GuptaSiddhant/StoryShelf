import type { ImageSettings } from "@storyshelf/core/adapter/capture-runner";
import { readSetting } from "@storyshelf/core/config";
/** Process-wide image settings, set once at app boot and read by the diff pool and thumbnails. */
import { IMAGE_ENGINE_ENV, type ImageEngineName, resolveImageEngine } from "./codec.ts";
import { loadCodec } from "./codecs.ts";
import { loadPixelmatch } from "./engine.ts";

export type { ImageSettings };

let configuredEngine: ImageEngineName | undefined;
let configuredThreads: number | undefined;

/**
 * Record the engine and thread count (the caller then rebuilds anything that depends on them).
 * The option wins: `SHELF_IMAGE_ENGINE` is read only when no engine is given, so a bad
 * variable cannot break an explicit option. Throws on an unknown name so a typo never silently
 * picks a different engine.
 */
export function setImageSettings(settings: ImageSettings): void {
  configuredEngine = resolveImageEngine(
    settings.engine ?? readSetting(process.env, IMAGE_ENGINE_ENV),
  );
  configuredThreads = settings.threads;
}

/** What the last {@link setImageSettings} resolved, without consulting the environment. */
export function appliedImageSettings(): {
  engine: ImageEngineName | undefined;
  threads: number | undefined;
} {
  return { engine: configuredEngine, threads: configuredThreads };
}

/** The engine in effect: the configured one, else the environment, else the default. */
export function currentImageEngine(): ImageEngineName {
  return configuredEngine ?? resolveImageEngine(readSetting(process.env, IMAGE_ENGINE_ENV));
}

/** The configured thread count, or `undefined` to defer to the environment/default. */
export function configuredThreadCount(): number | undefined {
  return configuredThreads;
}

/**
 * Load the engine's dependencies and `pixelmatch` now, so a missing peer fails readiness with a
 * message naming it instead of the first diff. Call it only with `testing`: a hosting-only
 * deployment never loads an image library.
 */
export async function verifyImageEngine(): Promise<ImageEngineName> {
  const engine = currentImageEngine();
  await Promise.all([loadCodec(engine), loadPixelmatch()]);
  return engine;
}
