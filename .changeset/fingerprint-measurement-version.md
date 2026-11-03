---
"@storyshelf/core": minor
"@storyshelf/app": minor
---

**Added: fingerprints carry a `measurementVersion` (#469, #273).** The capture-environment fingerprint stored on baselines (and in a snapshot's environment-change record) now records how its browser-measured components were read. It is not part of `infraHash`, so no baseline changes identity and nothing migrates; a fingerprint without it is version 1. When a later release changes a probe, the components it re-measures are compared as unknown across versions instead of as a mismatch, and the review shows "Environment partly unknown (measurement updated)". Nothing changes yet: version 1 is the only version.
