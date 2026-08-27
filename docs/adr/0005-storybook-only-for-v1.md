# ADR 0005: Storybook-Only for v1

## Status

Accepted

## Context

StoryShelf could support multiple component explorers: Storybook, Ladle, Histoire, and custom pages. Each has different story discovery, URL patterns, and index formats.

### Market data

| Tool | Weekly npm downloads | Story format | Status |
|------|---------------------|--------------|--------|
| Storybook | 2.5M | CSF (`.stories.tsx`) | Stable, v10 |
| Ladle | 100K | CSF (compatible) | Stable, v5.x |
| Histoire | 30K | `.story.vue` (proprietary) | Pre-1.0, alpha |

## Decision

Support only Storybook in v1. Design the capture pipeline with a `StorySourceAdapter` interface so Ladle and Histoire can be added later without changing the core.

### StorySourceAdapter interface

```typescript
interface StorySourceAdapter {
  name: string;
  discover(source: string): Promise<StoryEntry[]>;
  buildUrl(baseUrl: string, storyId: string): string;
  screenshotSelector?: string;
  waitForReady?(page: Page): Promise<void>;
}
```

### Addition roadmap

| Explorer | When | Effort | Why |
|----------|------|--------|-----|
| Storybook | v1 (now) | Baseline | 2.5M downloads, industry standard |
| Ladle | v2 (after v1 stable) | ~1 day | Uses same CSF format, nearly identical index.json |
| Histoire | v2.x (when it hits 1.0) | ~1 week | Different format, different URL patterns |
| Custom pages | v2.x (when a user asks) | ~1 day | Different workflow (URL list config file) |

## Consequences

**Positive:**
- Focus on the core product: screenshot capture + diff + review for Storybook users
- 80/20: Storybook covers the vast majority of the component explorer market
- The adapter interface ensures adding alternatives is mechanical, not architectural

**Negative:**
- Teams using Ladle/Histoire must wait for v2
- But: Lost Pixel (the only tool supporting all three) was archived April 2026 -- there's no competition in this space
