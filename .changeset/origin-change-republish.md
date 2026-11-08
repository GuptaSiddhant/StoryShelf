---
"@storyshelf/app": patch
---

Fixed: when an admin replaces the confirmed public origin with a different one, the state of open builds is requested again, so git statuses already posted stop linking to the old origin. Before, only the first confirmed origin did. Saving the same origin again, or a detected-but-unconfirmed report, asks for nothing, and chat, email and alerts are still never replayed.
