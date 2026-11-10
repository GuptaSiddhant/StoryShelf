---
"@storyshelf/core": patch
---

Fixed: published Storybook files are stored once, by content, instead of again per build

A zip upload no longer writes each extracted file a second time under `{project}/builds/{build}/storybook/`; only `content/<hash>` and the build's `manifest.json` are written. The capture orchestrator skips persisting again when publishing already wrote the manifest. Builds published before the content store still serve through the legacy fallback, and existing per-build copies are left in place.
