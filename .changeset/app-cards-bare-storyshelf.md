---
"@storyshelf/app": patch
---

Fixed: the get-started and projects cards show bare `npx storyshelf` after `init`

The get-started card is now two lines: `npx storyshelf init --url <origin> --slug <slug>` (writes the config file, no secret), then `SHELF_TOKEN=<token> npx storyshelf`. The projects empty state shows `npx storyshelf`. The origin is still the confirmed public origin or the placeholder, never the request's Host.
