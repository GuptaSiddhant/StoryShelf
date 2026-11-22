---
"@storyshelf/app": minor
---

Added: `storyshelf-server` names a missing peer, and `doctor` checks the installed packages first

When the instance module imports an optional peer that is not installed (a database driver, a storage SDK), `storyshelf-server` now says which package or subpath needs it, the range, and the `npm install` line, from the generated version and peer manifest. `storyshelf-server doctor` reads the installed `@storyshelf/*` packages before it imports the instance: it reports each peer as installed, out of range or missing, and fails on mixed `@storyshelf/*` versions or a second copy of `@storyshelf/core`.
