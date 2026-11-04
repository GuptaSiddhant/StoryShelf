---
"@storyshelf/core": patch
---

Content collection now reads the live builds' manifests eight at a time instead of one after another, which makes a pass on a remote store (S3, GCS, Azure) about eight times faster; a candidate is still kept when any live manifest names it, and the scan still stops once none is left. A manifest that cannot be read now ends the pass without deleting anything: every claim is given back and one warning with the counts is logged, where before the error stopped the pass and left the claims to expire.
