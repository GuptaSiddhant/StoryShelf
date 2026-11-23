---
"@storyshelf/core": patch
---

Fixed: hosting-only installs start their job consumers without the image libraries

The image engine check now runs only for a consumer with a `capture` handler. A consumer that only publishes or notifies starts without `pngjs`, `pixelmatch` or `sharp`; a testing consumer still refuses to start when they are missing.
