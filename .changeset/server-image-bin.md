---
"@storyshelf/app": minor
---

Changed: `storyshelf-server serve` honours `SHELF_SHUTDOWN_GRACE_SECONDS` and exits when it has drained

`serve` bounds the SIGTERM drain with `SHELF_SHUTDOWN_GRACE_SECONDS` (3 s on Fly when unset), logs the old setting names once under `SHELF_ALLOW_OLD_NAMES=1`, and the bin ends the process itself, so a handler that ignored its release cannot outlive the shutdown. The published image and the Fly demo now ship the bin as a second bundle input, on `PATH` as `storyshelf-server`, and their `CMD` is `storyshelf-server serve`: the server is a `defineShelfInstance` module (`dist/instance.mjs`, named by `package.json#storyshelf.server`) instead of a script that builds the app, so `docker run <image> storyshelf-server migrate` and `doctor` work against the same environment. A refused start prints `storyshelf-server serve: <reason>` instead of `storyshelf: <reason>`.

Schema: none.
