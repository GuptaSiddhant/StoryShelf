---
"@storyshelf/app": patch
"@storyshelf/core": patch
---

Changed: new StoryShelf logo, icons and wordmark

The app's default sidebar logo is the new mark on its violet tile, and the favicon is the bare mark, which follows the browser's light or dark tab colours (served at `/assets/favicon-<hash>.svg`). Notification emails open with the wordmark (the brand name, or `ui.name`, after `ui.logo` when one is set). `ui.name`, `ui.logo`, `SHELF_BRAND_NAME`, `SHELF_LOGO_URL` and brand packs still override the defaults; the favicon stays the product's own. See `docs/brand.md`.
