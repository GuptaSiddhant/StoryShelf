---
"@storyshelf/core": patch
---

Fixed: cancelling a build stops its running publish and notify jobs

A cancel now aborts a **running** publish job: the zip read stops, no further file or manifest is written, and the stopped run neither completes nor fails the build. A running notification delivery stops the same way, so a delivery that ends or fails after the cancel records no channel error and raises no delivery-failed event (a request already on the wire still finishes). Queued publish and notify jobs were already cancelled.
