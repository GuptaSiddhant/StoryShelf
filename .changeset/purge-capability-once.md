---
"@storyshelf/core": patch
"@storyshelf/app": patch
---

A build purge now reads the retention lifecycle capability once, when a pass starts, and uses that same capability for every deletion of the pass. A capability that is cleared while the candidates are being selected can no longer turn a manual or scheduled purge into an unfenced one.
