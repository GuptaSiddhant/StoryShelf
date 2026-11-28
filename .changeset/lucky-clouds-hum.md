---
"storyshelf": patch
---

Fixed: uploads from a git checkout no longer say no checkout was detected

A checkout with git HEAD and a branch was reported as a synthetic identity, so `storyshelf upload` printed "No git checkout detected" and the synthetic line. The check now follows the resolved sha and branch: only a value that no flag, CI variable or git supplied is synthesized. Upload output and the request body are otherwise unchanged; the server never received the synthesized flag.
