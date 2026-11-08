---
"@storyshelf/core": patch
---

Fix: two overlapping enqueues of one build could both stamp it and leave a superseded capture job running. A build's capture job now claims the build before it is queued, in one conditional write that also advances the run generation, so only one of two concurrent enqueues claims it. The job carries that generation and its worker ends it `cancelled`, writing nothing, when a retry has started a newer run. Finalizing a build (its final status and the dropping of orphan baselines) is conditional on the run's generation too.
