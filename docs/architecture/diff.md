# Pixel diff

> Part of the [StoryShelf architecture spec](./README.md).

## Pixel Diff Engine

```typescript
interface DiffOptions {
  pixelThreshold: number; // 0-1, per-pixel color distance (default: 0.1)
  maxDiffRatio: number; // 0-1, max allowed diff ratio (default: 0.01)
  includeAntialiasing: boolean;
  failOnSizeChange: boolean;
}

interface DiffResult {
  passed: boolean;
  diffPixels: number;
  diffRatio: number;
  diffImage: Buffer; // PNG overlay showing changed pixels in red
  baselineDimensions: { width: number; height: number };
  currentDimensions: { width: number; height: number };
  sizeChanged: boolean;
}
```

Uses `pixelmatch` for pixel comparison and a PNG codec for decode/encode: `pngjs` by default, or opt-in `sharp` (`testing.images.engine`, ADR 0008). The engine lives in `@storyshelf/image` (a leaf package), re-exported from `core/diff`.

### Diff Overlay

The diff image is an overlay where:

- Unchanged pixels are shown at 50% opacity
- Changed pixels are highlighted in red
- This gives a visual "heat map" of what changed

Thresholds are configurable per-project (`pixel_threshold`, `max_diff_ratio`) and overridable per-run via the CLI.
