---
"storyshelf": patch
---

Fixed: `storyshelf init` writes a stable `$schema` instead of a path into the npx cache

`init` writes a relative `node_modules/storyshelf/schema/…` path only when the CLI is installed in the project. From `npx` or a global install it writes the versioned `https://unpkg.com/storyshelf@<version>/schema/storyshelf-config.json` URL.

Schema: none.
