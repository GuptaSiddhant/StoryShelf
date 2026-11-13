---
"@storyshelf/core": minor
"@storyshelf/design-figma": minor
---

Changed: Figma is now built into core; @storyshelf/design-figma is a deprecated re-export (#884)

`@storyshelf/core/integrations` now exports `createFigmaDesign`, `figmaOAuthFromEnv` and the rest of what `@storyshelf/design-figma` did, and the app registers Figma as the built-in design provider. Link checks, metadata, renders and personal tokens work with no setup. "Connect Figma" (OAuth) stays off until the operator sets `FIGMA_CLIENT_ID` and `FIGMA_CLIENT_SECRET`.

`@storyshelf/design-figma` is deprecated: it re-exports `@storyshelf/core/integrations` for this one minor release and is then no longer published (ADR 0049). Drop `design: [createFigmaDesign()]` to use the built-in, or import from `@storyshelf/core/integrations`.
