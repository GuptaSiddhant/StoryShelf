---
"@storyshelf/core": minor
---

Added: a web push notifier (ADR 0048)

Core gains `@storyshelf/core/integrations/push`: a `push` message notifier addressed to a person, with VAPID signing (RFC 8292) and `aes128gcm` payload encryption (RFC 8291) on node's own crypto and no new dependency. A 404 or 410 from the push service throws `PushGoneError` so the caller can delete the device's row; other failures throw an error with no key, endpoint or response body. Configuration is `SHELF_VAPID_PUBLIC_KEY`, `SHELF_VAPID_PRIVATE_KEY` and `SHELF_VAPID_SUBJECT`; without both keys push is off. `httpStatus` and `httpText` accept a raw `body`.
