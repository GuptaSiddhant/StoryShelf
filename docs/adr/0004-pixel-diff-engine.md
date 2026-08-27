# ADR 0004: Pixel Diff Engine

## Status

Accepted

## Context

After the server captures screenshots (ADR 0003), it must compare them against baselines (ADR 0009) and produce a diff result. Chromatic uses proprietary pixel-level comparison with anti-flake heuristics. The self-hosted alternative needs a reliable, open-source diff engine.

## Decision

Use `pixelmatch` (by Mapbox) for pixel comparison and `pngjs` for PNG manipulation.

### Why pixelmatch

| Option | Pros | Cons |
|--------|------|------|
| **pixelmatch** | Battle-tested (used by Playwright internally), fast, supports anti-aliasing detection, configurable threshold | Pixel-based only (no AI/structural comparison) |
| resemble.js | Higher-level API, includes color difference metrics | Slower, less precise at pixel level |
| Applitools Visual AI | Fewest false positives | Proprietary, SaaS-only, not self-hostable |
| SSIM | Perceptual quality metric | Computationally expensive, not suited for CI speed |

### Diff configuration

The `DiffOptions` and `DiffResult` types live in `docs/architecture.md` (Pixel Diff Engine).

> **Naming note:** `pixelThreshold` is the per-pixel color distance; `maxDiffRatio` is the allowed ratio of differing pixels. These are deliberately named to match their meaning (an earlier draft had `threshold`/`diff_pixel_threshold` with swapped semantics — a bug farm).

### Diff overlay image

The diff image is generated as an overlay:
- Unchanged pixels: 50% opacity (grayed out)
- Changed pixels: highlighted in red (`[255, 0, 0]`)
- This creates a visual "heat map" showing exactly what changed

The diff overlay is stored at `data/{projectId}/builds/{buildId}/diffs/{storyId}/{viewport}.png` and served by the review UI.

### New / removed stories

The diff engine treats the absence of a baseline specially (see ADR 0009):

- **New story (no baseline):** on the default branch it is auto-approved and becomes the baseline; on a feature branch it is marked `new` for review.
- **Removed story (baseline but no current story):** no diff runs; the orphaned baseline is GC'd on the next default-branch build.

### Threshold configuration

Thresholds are configurable per-project (stored in the `projects` table):

```sql
pixel_threshold       -- per-pixel color distance (pixelmatch threshold)
max_diff_ratio        -- max allowed diff ratio
```

The CLI can also override thresholds per-run:

```bash
npx storyshelf upload --max-diff-ratio 0.02 --pixel-threshold 0.15
```

## Consequences

**Positive:**
- Same diff algorithm Playwright uses -- consistent with developer expectations
- Fast enough for CI (thousands of screenshots in seconds)
- Configurable thresholds reduce false positives
- No external service dependency

**Negative:**
- Pixel-based comparison can produce false positives on anti-aliased text, sub-pixel rendering, or animation remnants
- Mitigated by: deterministic rendering (ADR 0003), animation disabling, threshold tuning
