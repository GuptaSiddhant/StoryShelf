# @storyshelf/image

StoryShelf's image engine: pixel diffing (pixelmatch), diff overlay rendering and thumbnails, run on a
worker-thread pool.

## Engines

The comparison is always pixelmatch; the **engine** is the PNG codec around it.

| Engine            | Install         | Notes                                              |
| ----------------- | --------------- | -------------------------------------------------- |
| `pngjs` (default) | built in        | Pure JavaScript, runs anywhere.                    |
| `sharp`           | `nub add sharp` | Native (libvips); several times faster on big PNGs |

## Usage

Most users never import this package; set the engine on `createShelfApp`:

```ts
createShelfApp({ ..., testing: { runner, images: { engine: "sharp" } } });
```

or set `STORYSHELF_IMAGE_ENGINE=sharp`. The option wins over the variable.

## API

```ts
import {
  diffImages, // (baseline, current, options, codec?) -> Promise<DiffResult>
  diffImagesAsync, // same, on the shared worker-thread pool
  downscalePng, // (png, maxEdge) -> Promise<Uint8Array>, on the configured engine
  configureImages, // ({ engine?, threads? }) apply testing.images.engine and testing.compare.threads
  verifyImageEngine, // load the configured engine now; rejects when it cannot load
  shutdownDiffPool, // stop the pool's workers
  DEFAULT_DIFF_OPTIONS,
  type DiffOptions,
  type DiffResult,
  type ImageEngine,
} from "@storyshelf/image";
```

`configureImages` is process-wide. The option beats `STORYSHELF_IMAGE_ENGINE`, and an unknown engine name throws.

## License

MIT
