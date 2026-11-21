---
"@storyshelf/app": patch
---

Fixed: a repeated SIGTERM or SIGINT during shutdown no longer kills the process mid-drain

`startServer` with `handleSignals` removed its signal handlers when shutdown started, so a second signal hit the default action. It now keeps them until the shutdown settles.
