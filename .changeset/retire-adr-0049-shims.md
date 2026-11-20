---
"@storyshelf/core": minor
"storyshelf": patch
---

Breaking: notify-git, notify-chat, notify-email, design-figma and image are no longer published; import from @storyshelf/core (ADR 0049)

These five packages shipped in 0.13.0 as deprecated re-exports of code that now lives in `@storyshelf/core`. 0.14.0 stops publishing them, as ADR 0049 §8 decided. `@storyshelf/cli` no longer treats a `@storyshelf/notify-git` dependency as a git channel; the built-in integrations are always registered.
