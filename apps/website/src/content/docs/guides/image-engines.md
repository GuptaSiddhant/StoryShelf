---
title: Image engines
description: Choose the PNG library behind diffs, diff overlays, and AI thumbnails — pure-JavaScript pngjs by default, or the faster native sharp.
---

StoryShelf compares screenshots with [pixelmatch](https://github.com/mapbox/pixelmatch). Around that comparison, something has to decode the two PNGs, encode the overlay of a failing diff, and shrink screenshots into thumbnails for [AI insights](/guides/config/). That something is the **image engine**:

| Engine            | What it is                          | Install                | Runs on                                                    |
| ----------------- | ----------------------------------- | ---------------------- | ---------------------------------------------------------- |
| `pngjs` (default) | Pure JavaScript                     | Built in               | Everywhere Node runs, including serverless and edge-ish hosts |
| `sharp`           | Native ([libvips](https://www.libvips.org/)) | `npm install sharp`    | Platforms with a prebuilt `sharp` binary                   |

The engine only changes how PNGs are read and written. The comparison is pixelmatch either way, so **verdicts and differing-pixel counts are the same** on both engines.

## Switching to sharp

```ts
createShelfApp({
  // ...
  images: { engine: "sharp" },
});
```

or set `STORYSHELF_IMAGE_ENGINE=sharp` (the option wins over the variable). Install `sharp` next to StoryShelf; it is an optional peer dependency.

If the name is unknown, or `sharp` is not installed or has no binary for the platform, StoryShelf refuses to start (readiness fails under `images`) instead of quietly falling back, so a typo never changes your diffs without anyone noticing. The engine in use is logged on each capture attempt's `render pass finished` line.

The engine is chosen per deployment, not per project. Baselines are stored PNGs and every build is diffed fresh against them, so you can switch engines at any time without re-approving anything.

## Does it change my results?

Both engines decode the common PNG types to identical pixels (RGB, RGBA, greyscale, palette, interlaced, gamma-tagged), and the test suite checks that diff results match. The one difference is 16-bit PNGs, which round to 8 bits slightly differently (at most one level out of 255, well under the default pixel threshold). Browser screenshots are 8-bit, so you will not meet this in practice. The diff overlay image is pixel-identical; only the PNG file bytes differ.

## Performance

Median milliseconds on an Apple M1 Max (Node 24). Screenshots are the StoryShelf UI at 1920 px wide, either a single viewport or a stacked full page. Each engine runs one diff at a time (diffs run on a worker pool, so a busy server does many at once).

**Viewport (1920×1050)**

| Step                           | pngjs | sharp | Speed-up |
| ------------------------------ | ----: | ----: | -------: |
| Decode a PNG                   |    17 |     4 |     4.6x |
| Encode a diff overlay          |   110 |     9 |    11.9x |
| Diff: noise only (passes)      |    41 |    17 |     2.4x |
| Diff: small change             |   176 |    36 |     4.9x |
| Diff: everything changed       |   355 |   238 |     1.5x |

**Full page (1920×7320)**

| Step                           | pngjs | sharp | Speed-up |
| ------------------------------ | ----: | ----: | -------: |
| Decode a PNG                   |   105 |    24 |     4.3x |
| Encode a diff overlay          |   764 |    64 |    12.0x |
| Diff: noise only (passes)      |   247 |    80 |     3.1x |
| Diff: small change             |  1153 |   237 |     4.9x |
| Diff: everything changed       |  2510 |  1690 |     1.5x |

Where the gain comes from: decoding and encoding PNGs is what `sharp` accelerates, and a diff that passes spends most of its time decoding. When nearly every pixel differs, the pixelmatch comparison itself dominates and the gain shrinks to about 1.5x. Expect the biggest improvement on large full-page screenshots and on builds with many small changes.

The numbers depend on your hardware and screenshots. Reproduce them on yours:

```sh
cd packages/image
nub run bench                  # the StoryShelf UI screenshots
nub run bench -- ./my-shots    # a folder of NAME-light.png / NAME-dark.png pairs
```

## Which should I use?

- **Stay on `pngjs`** if you want zero native dependencies, deploy to a runtime without `sharp` binaries, or your builds are small. It needs no setup.
- **Switch to `sharp`** if capture or re-diff time is dominated by large screenshots, and you run on Linux, macOS, or Windows where `sharp` installs cleanly.
