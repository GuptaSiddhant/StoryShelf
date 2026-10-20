# @storyshelf/image

StoryShelf's image engine: pixel diffing (pixelmatch), diff overlay rendering and thumbnails, run on a
worker-thread pool.

Two codecs decode and encode the PNGs; the comparison itself is always pixelmatch, so verdicts match.

| Engine            | Install         | Notes                                              |
| ----------------- | --------------- | -------------------------------------------------- |
| `pngjs` (default) | built in        | Pure JavaScript, runs anywhere.                    |
| `sharp`           | `nub add sharp` | Native (libvips); several times faster on big PNGs |

## Usage

Most users never import this package; set the engine on `createShelfApp`:

```ts
createShelfApp({ ..., images: { engine: "sharp" } });
```

or set `STORYSHELF_IMAGE_ENGINE=sharp`. The option wins over the variable.

## License

MIT
