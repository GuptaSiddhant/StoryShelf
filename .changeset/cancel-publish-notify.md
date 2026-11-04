---
"@storyshelf/core": patch
---

Fixed: cancelling a build now also stops a **running** publish job: the zip read is aborted, no further file or manifest is written, and the build is neither completed nor failed by the stopped run. A running notification delivery that fails after its job was cancelled no longer records an error on the channel or raises the delivery-failed event (a request already on the wire still finishes). Queued publish and notification jobs were already cancelled.
